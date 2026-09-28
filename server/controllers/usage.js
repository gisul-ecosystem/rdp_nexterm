const { Op } = require("sequelize");
const AuditLog = require("../models/AuditLog");
const Account = require("../models/Account");
const Entry = require("../models/Entry");
const Organization = require("../models/Organization");
const SessionManager = require("../lib/SessionManager");
const logger = require("../utils/logger");
const { getSystemPermissions } = require("../permissions/engine");
const { getAuditableOrganizationIds, SESSION_ACTIONS } = require("./audit");
const { ACCOUNT_VIEW_ATTRIBUTES, toAccountView } = require("../utils/accountView");

const MAX_SESSION_ROWS = 10000;
const ADMIN_DISCONNECT_CODE = 4018;

// System admins see every user; everyone else sees their own sessions plus organizations they may audit.
const resolveScope = async (accountId) => {
    const { isAdmin } = await getSystemPermissions(accountId);
    return { accountId, isAdmin, organizationIds: isAdmin ? [] : await getAuditableOrganizationIds(accountId) };
};

const scopeWhere = (scope) => scope.isAdmin ? {} : {
    [Op.or]: [{ accountId: scope.accountId }, { organizationId: { [Op.in]: scope.organizationIds } }],
};

const canSee = (scope, session) => scope.isAdmin
    || Number(session.accountId) === Number(scope.accountId)
    || (session.organizationId != null && scope.organizationIds.includes(Number(session.organizationId)));

const protocolOfAction = (action) => action.replace(/^entry\./, "").replace(/_connect$/, "");

const protocolOfEntry = (entry) => (entry?.type === "server" ? entry.config?.protocol : entry?.type) || null;

const loadNames = async ({ accountIds, entryIds, organizationIds }) => {
    const [accounts, entries, organizations] = await Promise.all([
        accountIds.size ? Account.findAll({ where: { id: [...accountIds] }, attributes: ACCOUNT_VIEW_ATTRIBUTES }) : [],
        entryIds.size ? Entry.findAll({ where: { id: [...entryIds] }, attributes: ["id", "name", "type", "config"] }) : [],
        organizationIds.size ? Organization.findAll({ where: { id: [...organizationIds] }, attributes: ["id", "name"] }) : [],
    ]);
    return {
        accounts: new Map(accounts.map((a) => [a.id, toAccountView(a)])),
        entries: new Map(entries.map((e) => [e.id, e])),
        organizations: new Map(organizations.map((o) => [o.id, o.name])),
    };
};

const collectIds = (items, pick) => {
    const ids = { accountIds: new Set(), entryIds: new Set(), organizationIds: new Set() };
    for (const item of items) {
        const { accountId, entryId, organizationId } = pick(item);
        if (accountId) ids.accountIds.add(accountId);
        if (entryId) ids.entryIds.add(entryId);
        if (organizationId) ids.organizationIds.add(organizationId);
    }
    return ids;
};

const secondsBetween = (start, end) => Math.max(0, Math.round((end - start) / 1000));

const toIso = (value) => {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
};

const toSessionRow = (log, liveByAuditId, names, now) => {
    const details = log.details || {};
    const loginAt = toIso(details.loginAt) || toIso(log.timestamp);
    const live = liveByAuditId.get(log.id);
    const status = details.logoutAt ? "ended" : live ? "live" : "unknown";
    const endMs = !loginAt ? null : details.logoutAt ? Date.parse(details.logoutAt) : status === "live" ? now : null;
    const entry = names.entries.get(log.resourceId);

    return {
        id: log.id,
        sessionId: live?.sessionId || null,
        user: names.accounts.get(log.accountId) || { id: log.accountId },
        entryId: log.resourceId,
        entryName: entry?.name || details.name || null,
        entryDeleted: !entry,
        protocol: protocolOfAction(log.action),
        organizationId: log.organizationId,
        organizationName: names.organizations.get(log.organizationId) || null,
        loginAt,
        logoutAt: details.logoutAt || null,
        lastSeenAt: details.lastSeenAt || null,
        durationSeconds: endMs === null ? null : secondsBetween(Date.parse(loginAt), endMs),
        status,
        closeReason: details.closeReason || null,
        closeDetail: details.closeDetail || null,
        connectionReason: log.reason || details.connectionReason || null,
        ipAddress: log.ipAddress,
        userAgent: log.userAgent,
    };
};

const summarize = (rows) => {
    const byUser = new Map();
    const byMachine = new Map();
    let totalSeconds = 0;
    let live = 0;

    const add = (map, key, base, seconds) => {
        const item = map.get(key) || { ...base, sessions: 0, seconds: 0 };
        item.sessions++;
        item.seconds += seconds;
        map.set(key, item);
    };

    for (const row of rows) {
        const seconds = row.durationSeconds || 0;
        totalSeconds += seconds;
        if (row.status === "live") live++;
        add(byUser, row.user.id, { user: row.user }, seconds);
        add(byMachine, row.entryId, { entryId: row.entryId, entryName: row.entryName, entryDeleted: row.entryDeleted }, seconds);
    }

    const bySeconds = (a, b) => b.seconds - a.seconds;
    return {
        totals: { sessions: rows.length, live, totalSeconds, users: byUser.size, machines: byMachine.size },
        byUser: [...byUser.values()].sort(bySeconds),
        byMachine: [...byMachine.values()].sort(bySeconds),
    };
};

const querySessionRows = async (scope, filters) => {
    const where = { action: SESSION_ACTIONS, ...scopeWhere(scope) };
    if (filters.accountId) where.accountId = filters.accountId;
    if (filters.entryId) where.resourceId = filters.entryId;
    if (filters.organizationId === "personal") where.organizationId = null;
    else if (filters.organizationId) where.organizationId = filters.organizationId;
    if (filters.from || filters.to) {
        where.timestamp = {};
        if (filters.from) where.timestamp[Op.gte] = new Date(filters.from).toISOString();
        if (filters.to) where.timestamp[Op.lte] = new Date(filters.to).toISOString();
    }

    const logs = await AuditLog.findAll({ where, order: [["timestamp", "DESC"]], limit: MAX_SESSION_ROWS });
    const names = await loadNames(collectIds(logs, (l) => ({ accountId: l.accountId, entryId: l.resourceId, organizationId: l.organizationId })));
    const liveByAuditId = new Map(SessionManager.listAll().filter((s) => s.auditLogId).map((s) => [s.auditLogId, s]));
    const now = Date.now();

    let rows = logs.map((log) => toSessionRow(log, liveByAuditId, names, now));
    if (filters.status) rows = rows.filter((row) => row.status === filters.status);
    return { rows, truncated: logs.length === MAX_SESSION_ROWS };
};

const listSessions = async (accountId, filters) => {
    try {
        const scope = await resolveScope(accountId);
        const { rows, truncated } = await querySessionRows(scope, filters);
        const { limit = 50, offset = 0 } = filters;
        return { sessions: rows.slice(offset, offset + limit), total: rows.length, truncated, ...summarize(rows) };
    } catch (error) {
        logger.error("Error listing usage sessions", { error: error.message, accountId });
        return { code: 500, message: "Failed to load usage" };
    }
};

const CSV_COLUMNS = [
    ["Audit ID", (r) => r.id],
    ["User", (r) => [r.user.firstName, r.user.lastName].filter(Boolean).join(" ")],
    ["Username", (r) => r.user.username],
    ["Machine", (r) => r.entryName || `#${r.entryId}`],
    ["Protocol", (r) => r.protocol],
    ["Organization", (r) => r.organizationName || ""],
    ["Login (UTC)", (r) => r.loginAt],
    ["Logout (UTC)", (r) => r.logoutAt || ""],
    ["Duration (seconds)", (r) => r.durationSeconds ?? ""],
    ["Status", (r) => r.status],
    ["Close reason", (r) => r.closeReason || ""],
    ["Close detail", (r) => r.closeDetail || ""],
    ["Connection reason", (r) => r.connectionReason || ""],
    ["IP address", (r) => r.ipAddress || ""],
    ["User agent", (r) => r.userAgent || ""],
];

// Spreadsheet apps execute cells starting with these characters as formulas.
const csvCell = (value) => {
    let text = String(value ?? "");
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const exportSessionsCsv = async (accountId, filters) => {
    try {
        const scope = await resolveScope(accountId);
        const { rows } = await querySessionRows(scope, filters);
        const lines = [CSV_COLUMNS.map(([label]) => label).join(",")];
        for (const row of rows) lines.push(CSV_COLUMNS.map(([, get]) => csvCell(get(row))).join(","));
        return { csv: lines.join("\r\n") + "\r\n" };
    } catch (error) {
        logger.error("Error exporting usage sessions", { error: error.message, accountId });
        return { code: 500, message: "Failed to export usage" };
    }
};

const listFilterOptions = async (accountId) => {
    try {
        const scope = await resolveScope(accountId);
        const logs = await AuditLog.findAll({
            where: { action: SESSION_ACTIONS, ...scopeWhere(scope) },
            attributes: ["accountId", "resourceId", "organizationId", "details"],
            order: [["timestamp", "DESC"]],
            limit: MAX_SESSION_ROWS,
        });
        const names = await loadNames(collectIds(logs, (l) => ({ accountId: l.accountId, entryId: l.resourceId, organizationId: l.organizationId })));

        const machines = new Map();
        for (const log of logs) {
            if (machines.has(log.resourceId)) continue;
            const entry = names.entries.get(log.resourceId);
            machines.set(log.resourceId, { entryId: log.resourceId, entryName: entry?.name || log.details?.name || null, entryDeleted: !entry });
        }

        return {
            users: [...names.accounts.values()],
            machines: [...machines.values()],
            organizations: [...names.organizations].map(([id, name]) => ({ id, name })),
        };
    } catch (error) {
        logger.error("Error listing usage filter options", { error: error.message, accountId });
        return { code: 500, message: "Failed to load filter options" };
    }
};

const liveState = (session) => {
    if (session.isHibernated) return "hibernated";
    if (!session.masterConnection) return "connecting";
    return session.connectedWs.size > 0 ? "active" : "unattended";
};

const listLiveSessions = async (accountId) => {
    try {
        const scope = await resolveScope(accountId);
        const sessions = SessionManager.listAll().filter((s) => canSee(scope, s));
        const names = await loadNames(collectIds(sessions, (s) => ({ accountId: s.accountId, entryId: Number(s.entryId), organizationId: s.organizationId })));

        return sessions
            .map((s) => {
                const entry = names.entries.get(Number(s.entryId));
                return {
                    sessionId: s.sessionId,
                    auditLogId: s.auditLogId,
                    user: names.accounts.get(s.accountId) || { id: s.accountId },
                    entryId: Number(s.entryId),
                    entryName: entry?.name || null,
                    protocol: s.configuration?.type === "sftp" ? "sftp" : protocolOfEntry(entry),
                    organizationId: s.organizationId || null,
                    organizationName: names.organizations.get(s.organizationId) || null,
                    startedAt: s.createdAt,
                    lastActivity: s.lastActivity,
                    state: liveState(s),
                    viewers: s.connectedWs.size,
                    sharedViewers: s.sharedWs.size,
                    canDisconnect: scope.isAdmin || Number(s.accountId) === Number(accountId),
                };
            })
            .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
    } catch (error) {
        logger.error("Error listing live sessions", { error: error.message, accountId });
        return { code: 500, message: "Failed to load live sessions" };
    }
};

const disconnectSession = async (accountId, sessionId) => {
    const session = SessionManager.get(sessionId);
    if (!session) return { code: 404, message: "Session not found" };

    const own = Number(session.accountId) === Number(accountId);
    if (own) {
        await SessionManager.remove(sessionId, { closeReason: "user_disconnect" });
        return { message: "Session disconnected" };
    }

    const scope = await resolveScope(accountId);
    if (!scope.isAdmin) return { code: 403, message: "Only administrators can disconnect other users' sessions" };

    const admin = await Account.findByPk(accountId, { attributes: ["username"] });
    logger.info("Session disconnected by administrator", { sessionId, adminId: accountId, ownerId: session.accountId });
    await SessionManager.remove(sessionId, {
        code: ADMIN_DISCONNECT_CODE,
        reason: "Disconnected by an administrator",
        closeReason: "admin_disconnect",
        closeDetail: `by ${admin?.username || `account ${accountId}`}`,
    });
    return { message: "Session disconnected" };
};

module.exports = { listSessions, exportSessionsCsv, listFilterOptions, listLiveSessions, disconnectSession };
