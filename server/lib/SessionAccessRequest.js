const { v4: uuidv4 } = require("uuid");
const Account = require("../models/Account");
const Entry = require("../models/Entry");
const Session = require("../models/Session");
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

const DEFAULT_PORTS = { rdp: 3389, vnc: 5900, ssh: 22, telnet: 23 };

const protocolOf = (entry) => (entry.type === "server" ? entry.config?.protocol : entry.type) || null;

// Several entries can point at the same machine; conflicts are about the machine, not the entry.
const targetKeyOf = (entry) => {
    if (!entry) return null;
    const protocol = protocolOf(entry);
    const ip = entry.config?.ip;
    if (!ip) return `entry:${entry.id}`;
    const port = Number(entry.config?.port) || DEFAULT_PORTS[protocol] || "";
    return `${protocol}|${String(ip).trim().toLowerCase()}|${port}`;
};

// A "person" is one browser sign-in. Several people may share one account, so the account alone cannot tell them
// apart: the login session (one per sign-in) and the browser id (one per browser profile) can.
const personOf = (source) => ({
    accountId: Number(source.accountId),
    loginSessionId: source.loginSessionId ?? null,
    browserId: source.browserId ?? null,
});

const samePerson = (a, b) => {
    if (Number(a.accountId) !== Number(b.accountId)) return false;
    if (a.loginSessionId && a.loginSessionId === b.loginSessionId) return true;
    if (a.browserId && a.browserId === b.browserId) return true;
    const comparable = (a.loginSessionId && b.loginSessionId) || (a.browserId && b.browserId);
    return !comparable;
};

// Tabs of the state stream (the channel the popup travels on) that belong to `person` but not to `other`.
const tabsOf = (person, other = null) => (conn) => {
    const tab = { accountId: person.accountId, loginSessionId: conn.sessionId ?? null, browserId: conn.browserId ?? null };
    return samePerson(tab, person) && !(other && samePerson(tab, other));
};

const pushTo = (person, other, data) =>
    stateBroadcaster.pushWhere(person.accountId, tabsOf(person, other), "ACCESS_REQUEST", data);

const isReachable = (person, other) => stateBroadcaster.hasConnection(person.accountId, tabsOf(person, other));

const sessionsOnTarget = async (targetKey) => {
    const sessions = getAllSessionsInternal().filter((s) => !s.isHibernated);
    if (!sessions.length) return [];
    const entryIds = [...new Set(sessions.map((s) => Number(s.entryId)))];
    const entries = await Entry.findAll({ where: { id: entryIds }, attributes: ["id", "type", "config"] });
    const keyByEntry = new Map(entries.map((e) => [e.id, targetKeyOf(e)]));
    return sessions.filter((s) => keyByEntry.get(Number(s.entryId)) === targetKey);
};

const closeSessionsOf = async (person, targetKey, reason) => {
    const toClose = (await sessionsOnTarget(targetKey)).filter((s) => samePerson(personOf(s), person));
    for (const session of toClose) {
        try {
            await SessionManager.remove(session.sessionId, { code: 4015, reason, closeReason: "replaced" });
        } catch (err) {
            logger.error("Failed to close session on the requested machine", { sessionId: session.sessionId, error: err.message });
        }
    }
    if (toClose.length) stateBroadcaster.broadcast("CONNECTIONS", { accountId: person.accountId });
    return toClose;
};

// Windows RDP gives a user one seat per machine: a second login takes the first one over anyway.
const replaceOwnRdpSessions = async (entry, person, targetKey) => {
    if (protocolOf(entry) !== "rdp") return;
    const replaced = await closeSessionsOf(person, targetKey, "Opened in another tab");
    if (replaced.length) logger.info("Replaced own RDP session on the same machine", { entryId: entry.id, count: replaced.length });
};

const BROWSERS = [["Edg/", "Edge"], ["OPR/", "Opera"], ["Firefox/", "Firefox"], ["Chrome/", "Chrome"], ["Safari/", "Safari"]];
const SYSTEMS = [["Windows", "Windows"], ["Android", "Android"], ["iPhone", "iOS"], ["iPad", "iOS"], ["Mac OS", "macOS"], ["Linux", "Linux"]];

const describeDevice = (userAgent) => {
    const ua = userAgent || "";
    const browser = BROWSERS.find(([marker]) => ua.includes(marker))?.[1];
    const system = SYSTEMS.find(([marker]) => ua.includes(marker))?.[1];
    if (browser && system) return `${browser} on ${system}`;
    return browser || system || "another device";
};

const deviceOf = async (person) => {
    if (!person.loginSessionId) return null;
    const login = await Session.findByPk(person.loginSessionId, { attributes: ["ip", "userAgent"] });
    if (!login) return null;
    return { label: describeDevice(login.userAgent), ip: login.ip ? login.ip.replace(/^::ffff:/, "") : null };
};

const serializeRequest = (req) => ({
    requestId: req.requestId,
    entryId: req.entryId,
    entryName: req.entryName,
    holderEntryName: req.holderEntryName,
    status: req.status,
    timedOut: !!req.timedOut,
    requester: req.requester,
    holder: req.holder,
    sameAccount: req.sameAccount,
    // Device details only go to people who already share the account.
    requesterDevice: req.sameAccount ? req.requesterDevice : null,
    holderDevice: req.sameAccount ? req.holderDevice : null,
    expiresAt: req.expiresAt,
    decidedAt: req.decidedAt || null,
    decision: req.decision || null,
});

const notifyBoth = (req) => {
    const payload = serializeRequest(req);
    pushTo(req.holderPerson, req.requesterPerson, { ...payload, role: "holder" });
    pushTo(req.requesterPerson, req.holderPerson, { ...payload, role: "requester" });
    return payload;
};

const audit = async ({ accountId, organizationId, entryId, reason, details }) => {
    try {
        await createAuditLog({
            accountId,
            organizationId,
            action: AUDIT_ACTIONS.ACCESS_REQUEST,
            resource: RESOURCE_TYPES.ENTRY,
            resourceId: entryId,
            details,
            reason,
        });
    } catch (err) {
        logger.error("Failed to audit access request", { error: err.message });
    }
};

const createRequest = async ({ entryId, requesterPerson, holderSession, targetKey, type = null }) => {
    const holderPerson = personOf(holderSession);
    const [entry, holderEntry, requester, holderAccount, requesterDevice, holderDevice] = await Promise.all([
        Entry.findByPk(entryId, { attributes: ["id", "name", "organizationId"] }),
        Entry.findByPk(holderSession.entryId, { attributes: ["id", "name"] }),
        Account.findByPk(requesterPerson.accountId, { attributes: ACCOUNT_VIEW_ATTRIBUTES }),
        Account.findByPk(holderPerson.accountId, { attributes: ACCOUNT_VIEW_ATTRIBUTES }),
        deviceOf(requesterPerson),
        deviceOf(holderPerson),
    ]);

    const requestId = uuidv4();
    const req = {
        requestId,
        entryId: Number(entryId),
        targetKey,
        entryName: entry?.name || `Entry ${entryId}`,
        holderEntryName: holderEntry?.name || entry?.name || `Entry ${entryId}`,
        organizationId: entry?.organizationId || holderSession.organizationId || null,
        type,
        status: "pending",
        requesterAccountId: requesterPerson.accountId,
        holderAccountId: holderPerson.accountId,
        requesterPerson,
        holderPerson,
        holderSessionId: holderSession.sessionId,
        sameAccount: requesterPerson.accountId === holderPerson.accountId,
        requester: toAccountView(requester),
        holder: toAccountView(holderAccount),
        requesterDevice,
        holderDevice,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + REQUEST_TTL_MS).toISOString(),
        decidedAt: null,
        decision: null,
        timeout: null,
    };

    req.timeout = setTimeout(() => {
        resolveRequest(requestId, "timeout", null).catch(() => {});
    }, REQUEST_TTL_MS);

    pending.set(requestId, req);
    const payload = notifyBoth(req);

    logger.info("Access request created", {
        requestId,
        entryId,
        requesterAccountId: req.requesterAccountId,
        holderAccountId: req.holderAccountId,
        sameAccount: req.sameAccount,
    });

    return payload;
};

const getRequest = (requestId) => pending.get(requestId) || null;

const resolveRequest = async (requestId, decision, actor) => {
    const req = pending.get(requestId);
    if (!req) return { code: 404, message: "Access request not found" };
    if (req.status !== "pending") return { code: 409, message: "Access request already resolved", request: serializeRequest(req) };

    if (decision === "timeout") {
        // system
    } else if (!actor || !samePerson(personOf(actor), req.holderPerson) || samePerson(personOf(actor), req.requesterPerson)) {
        return { code: 403, message: "Only the active session owner can respond" };
    } else if (decision !== "allow" && decision !== "deny") {
        return { code: 400, message: "decision must be allow or deny" };
    }

    if (req.timeout) clearTimeout(req.timeout);
    req.timeout = null;
    req.decidedAt = new Date().toISOString();
    req.decision = decision === "timeout" ? "deny" : decision;
    req.timedOut = decision === "timeout";
    req.status = req.decision === "allow" ? "approved" : "denied";

    if (req.status === "approved") {
        await closeSessionsOf(req.holderPerson, req.targetKey, "Taken over by another user");
        if (req.organizationId) stateBroadcaster.broadcast("LIVE_SESSIONS", { organizationId: req.organizationId });
    }

    const payload = notifyBoth(req);

    await audit({
        accountId: actor?.accountId || req.holderAccountId,
        organizationId: req.organizationId,
        entryId: req.entryId,
        reason: req.timedOut ? "timeout" : req.decision,
        details: {
            requestId: req.requestId,
            decision: req.decision,
            status: req.status,
            timedOut: req.timedOut,
            sameAccount: req.sameAccount,
            requesterAccountId: req.requesterAccountId,
            holderAccountId: req.holderAccountId,
            requesterDevice: req.requesterDevice,
            holderDevice: req.holderDevice,
            entryName: req.entryName,
        },
    });

    // Keep approved briefly so requester can redeem; deny can drop sooner
    const keepMs = req.status === "approved" ? 60_000 : 15_000;
    setTimeout(() => pending.delete(requestId), keepMs);

    logger.info("Access request resolved", { requestId, decision: req.decision, status: req.status });
    return { request: payload };
};

// The requester gave up waiting: close the holder's popup so a late "Allow" cannot disconnect them for nobody.
const cancelRequest = (requestId, actor) => {
    const req = pending.get(requestId);
    if (!req) return { code: 404, message: "Access request not found" };
    if (!actor || !samePerson(personOf(actor), req.requesterPerson) || samePerson(personOf(actor), req.holderPerson)) {
        return { code: 403, message: "Only the requester can cancel" };
    }
    if (req.status !== "pending") return { code: 409, message: "Access request already resolved", request: serializeRequest(req) };

    if (req.timeout) clearTimeout(req.timeout);
    req.timeout = null;
    req.status = "cancelled";
    req.decidedAt = new Date().toISOString();

    const payload = notifyBoth(req);
    setTimeout(() => pending.delete(requestId), 15_000);

    logger.info("Access request cancelled", { requestId });
    return { request: payload };
};

const consumeApproved = (requestId, requesterPerson, entryId) => {
    const req = pending.get(requestId);
    if (!req) return { code: 404, message: "Access request not found" };
    if (req.status !== "approved") return { code: 403, message: "Access request was not approved" };
    if (!samePerson(requesterPerson, req.requesterPerson)) return { code: 403, message: "Access request belongs to another user" };
    if (Number(req.entryId) !== Number(entryId)) return { code: 400, message: "Access request is for a different entry" };
    pending.delete(requestId);
    return { ok: true, request: serializeRequest(req) };
};

const waitingResponse = (request, message) => ({
    code: 409,
    message,
    needsPermission: true,
    requestId: request.requestId,
    holder: request.holder,
    sameAccount: request.sameAccount,
    holderDevice: request.sameAccount ? request.holderDevice : null,
    expiresAt: request.expiresAt,
});

const holderLabel = (request) => request.sameAccount
    ? `another device signed in as ${request.holder?.username || "you"}`
    : request.holder?.username || "another user";

const checkConflict = async ({ entryId, accountId, type, scriptId, permissionRequestId, loginSessionId = null, browserId = null }) => {
    if (skipPermissionCheck(type, scriptId)) return null;

    const requesterPerson = personOf({ accountId, loginSessionId, browserId });
    const entry = await Entry.findByPk(entryId, { attributes: ["id", "type", "config", "organizationId"] });
    const targetKey = targetKeyOf(entry);

    if (permissionRequestId) {
        const consumed = consumeApproved(permissionRequestId, requesterPerson, entryId);
        if (consumed.code) return consumed;
        if (entry) await replaceOwnRdpSessions(entry, requesterPerson, targetKey);
        return null;
    }

    const holders = targetKey
        ? (await sessionsOnTarget(targetKey)).filter((s) => !samePerson(personOf(s), requesterPerson))
        : [];

    // Only someone with Nexterm open can answer; sessions nobody could be asked about are simply taken over.
    const reachable = holders.filter((s) => isReachable(personOf(s), requesterPerson));
    const unattended = holders.filter((s) => !reachable.includes(s));
    if (!reachable.length) {
        for (const person of unattended.map(personOf)) {
            const closed = await closeSessionsOf(person, targetKey, "Taken over by another user");
            if (!closed.length) continue;
            logger.info("Took over an unattended session", { entryId, holderAccountId: person.accountId, count: closed.length });
            await audit({
                accountId: requesterPerson.accountId,
                organizationId: entry?.organizationId || null,
                entryId: Number(entryId),
                reason: "unattended",
                details: { decision: "unattended_takeover", requesterAccountId: requesterPerson.accountId, holderAccountId: person.accountId },
            });
        }
        if (unattended.length && entry?.organizationId) stateBroadcaster.broadcast("LIVE_SESSIONS", { organizationId: entry.organizationId });
        if (entry) await replaceOwnRdpSessions(entry, requesterPerson, targetKey);
        return null;
    }

    // Prefer the most recently active holder
    reachable.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
    const holderSession = reachable[0];

    // Avoid stacking duplicate pending asks from the same person for the same entry
    for (const existing of pending.values()) {
        if (existing.status === "pending"
            && Number(existing.entryId) === Number(entryId)
            && samePerson(existing.requesterPerson, requesterPerson)) {
            return waitingResponse(serializeRequest(existing), `Waiting for approval from ${holderLabel(existing)}`);
        }
    }

    const request = await createRequest({ entryId, requesterPerson, holderSession, targetKey, type });
    return waitingResponse(request, `VM in use by ${holderLabel(request)} — waiting for approval`);
};

module.exports = {
    REQUEST_TTL_MS,
    checkConflict,
    cancelRequest,
    getRequest,
    resolveRequest,
    serializeRequest,
    samePerson,
};
