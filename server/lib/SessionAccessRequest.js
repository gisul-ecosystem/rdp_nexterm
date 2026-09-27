const { v4: uuidv4 } = require("uuid");
const Account = require("../models/Account");
const Entry = require("../models/Entry");
const SessionManager = require("./SessionManager");
const stateBroadcaster = require("./StateBroadcaster");
const logger = require("../utils/logger");
const { ACCOUNT_VIEW_ATTRIBUTES, toAccountView } = require("../utils/accountView");
const { createAuditLog, AUDIT_ACTIONS, RESOURCE_TYPES } = require("../controllers/audit");

const REQUEST_TTL_MS = 45_000;
const pending = new Map();

const skipPermissionCheck = (type, scriptId) =>
    type === "sftp" || type === "ftp" || type === "ftps" || !!scriptId;

const getAllSessionsInternal = () => SessionManager.listActiveSessions();

const findHolders = (entryId, excludeAccountId) => {
    const numericEntry = Number(entryId);
    const holders = [];
    for (const session of getAllSessionsInternal()) {
        if (Number(session.entryId) !== numericEntry) continue;
        if (session.isHibernated) continue;
        if (Number(session.accountId) === Number(excludeAccountId)) continue;
        holders.push(session);
    }
    return holders;
};

const serializeRequest = (req) => ({
    requestId: req.requestId,
    entryId: req.entryId,
    entryName: req.entryName,
    status: req.status,
    requester: req.requester,
    holder: req.holder,
    expiresAt: req.expiresAt,
    decidedAt: req.decidedAt || null,
    decision: req.decision || null,
});

const pushTo = (accountId, data) => {
    stateBroadcaster.push([accountId], "ACCESS_REQUEST", data);
};

const createRequest = async ({
    entryId,
    requesterAccountId,
    holderSession,
    type = null,
}) => {
    const [entry, requester, holderAccount] = await Promise.all([
        Entry.findByPk(entryId, { attributes: ["id", "name", "organizationId"] }),
        Account.findByPk(requesterAccountId, { attributes: ACCOUNT_VIEW_ATTRIBUTES }),
        Account.findByPk(holderSession.accountId, { attributes: ACCOUNT_VIEW_ATTRIBUTES }),
    ]);

    const requestId = uuidv4();
    const expiresAt = new Date(Date.now() + REQUEST_TTL_MS).toISOString();
    const req = {
        requestId,
        entryId: Number(entryId),
        entryName: entry?.name || `Entry ${entryId}`,
        organizationId: entry?.organizationId || holderSession.organizationId || null,
        type,
        status: "pending",
        requesterAccountId: Number(requesterAccountId),
        holderAccountId: Number(holderSession.accountId),
        holderSessionId: holderSession.sessionId,
        requester: toAccountView(requester),
        holder: toAccountView(holderAccount),
        createdAt: new Date().toISOString(),
        expiresAt,
        decidedAt: null,
        decision: null,
        timeout: null,
    };

    req.timeout = setTimeout(() => {
        resolveRequest(requestId, "timeout", null).catch(() => {});
    }, REQUEST_TTL_MS);

    pending.set(requestId, req);

    const payload = serializeRequest(req);
    pushTo(req.holderAccountId, { ...payload, role: "holder" });
    pushTo(req.requesterAccountId, { ...payload, role: "requester" });

    logger.info("Access request created", {
        requestId,
        entryId,
        requesterAccountId,
        holderAccountId: req.holderAccountId,
    });

    return payload;
};

const getRequest = (requestId) => pending.get(requestId) || null;

const resolveRequest = async (requestId, decision, actorAccountId) => {
    const req = pending.get(requestId);
    if (!req) return { code: 404, message: "Access request not found" };
    if (req.status !== "pending") return { code: 409, message: "Access request already resolved", request: serializeRequest(req) };

    if (decision === "timeout") {
        // system
    } else if (Number(actorAccountId) !== req.holderAccountId) {
        return { code: 403, message: "Only the active session owner can respond" };
    } else if (decision !== "allow" && decision !== "deny") {
        return { code: 400, message: "decision must be allow or deny" };
    }

    if (req.timeout) clearTimeout(req.timeout);
    req.timeout = null;
    req.decidedAt = new Date().toISOString();
    req.decision = decision === "timeout" ? "deny" : decision;
    req.status = req.decision === "allow" ? "approved" : "denied";

    if (req.status === "approved") {
        // Take over: close holder's sessions on this entry (Win10/11 single-session model)
        const toKick = getAllSessionsInternal().filter((s) =>
            Number(s.entryId) === req.entryId
            && Number(s.accountId) === req.holderAccountId
            && !s.isHibernated);
        for (const session of toKick) {
            try {
                await SessionManager.remove(session.sessionId, { code: 4015, reason: "Taken over by another user" });
            } catch (err) {
                logger.error("Failed to kick holder session", { sessionId: session.sessionId, error: err.message });
            }
        }
        stateBroadcaster.broadcast("CONNECTIONS", { accountId: req.holderAccountId });
        if (req.organizationId) stateBroadcaster.broadcast("LIVE_SESSIONS", { organizationId: req.organizationId });
    }

    const payload = serializeRequest(req);
    pushTo(req.holderAccountId, { ...payload, role: "holder" });
    pushTo(req.requesterAccountId, { ...payload, role: "requester" });

    try {
        await createAuditLog({
            accountId: actorAccountId || req.holderAccountId,
            organizationId: req.organizationId,
            action: AUDIT_ACTIONS.ACCESS_REQUEST,
            resource: RESOURCE_TYPES.ENTRY,
            resourceId: req.entryId,
            details: {
                requestId: req.requestId,
                decision: req.decision,
                status: req.status,
                requesterAccountId: req.requesterAccountId,
                holderAccountId: req.holderAccountId,
                entryName: req.entryName,
            },
            reason: req.decision,
        });
    } catch (err) {
        logger.error("Failed to audit access request", { error: err.message });
    }

    // Keep approved briefly so requester can redeem; deny can drop sooner
    const keepMs = req.status === "approved" ? 60_000 : 15_000;
    setTimeout(() => pending.delete(requestId), keepMs);

    logger.info("Access request resolved", { requestId, decision: req.decision, status: req.status });
    return { request: payload };
};

const consumeApproved = (requestId, accountId, entryId) => {
    const req = pending.get(requestId);
    if (!req) return { code: 404, message: "Access request not found" };
    if (req.status !== "approved") return { code: 403, message: "Access request was not approved" };
    if (Number(req.requesterAccountId) !== Number(accountId)) return { code: 403, message: "Access request belongs to another user" };
    if (Number(req.entryId) !== Number(entryId)) return { code: 400, message: "Access request is for a different entry" };
    pending.delete(requestId);
    return { ok: true, request: serializeRequest(req) };
};

const checkConflict = async ({ entryId, accountId, type, scriptId, permissionRequestId }) => {
    if (skipPermissionCheck(type, scriptId)) return null;

    if (permissionRequestId) {
        const consumed = consumeApproved(permissionRequestId, accountId, entryId);
        if (consumed.code) return consumed;
        return null;
    }

    const holders = findHolders(entryId, accountId);
    if (!holders.length) return null;

    // Prefer the most recently active holder
    holders.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
    const holderSession = holders[0];

    // Avoid stacking duplicate pending asks from same requester→entry
    for (const existing of pending.values()) {
        if (existing.status === "pending"
            && Number(existing.entryId) === Number(entryId)
            && Number(existing.requesterAccountId) === Number(accountId)) {
            return {
                code: 409,
                message: `Waiting for approval from ${existing.holder?.username || "the active user"}`,
                needsPermission: true,
                requestId: existing.requestId,
                holder: existing.holder,
                expiresAt: existing.expiresAt,
            };
        }
    }

    const request = await createRequest({
        entryId,
        requesterAccountId: accountId,
        holderSession,
        type,
    });

    return {
        code: 409,
        message: `VM in use by ${request.holder?.username || "another user"} — waiting for approval`,
        needsPermission: true,
        requestId: request.requestId,
        holder: request.holder,
        expiresAt: request.expiresAt,
    };
};

module.exports = {
    REQUEST_TTL_MS,
    checkConflict,
    getRequest,
    resolveRequest,
    serializeRequest,
};
