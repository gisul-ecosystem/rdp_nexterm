const Session = require("../models/Session");
const Account = require("../models/Account");
const stateBroadcaster = require("../lib/StateBroadcaster");
const { STATE_TYPES } = require("../lib/StateBroadcaster");
const healthService = require("../utils/healthService");
const { hasSystemPermission } = require("../permissions/engine");
const { Permission } = require("../permissions/registry");

module.exports = async (ws, req) => {
    const early = [];
    const queue = (msg) => early.push(msg);
    ws.on("message", queue);

    const { sessionToken, tabId, browserId } = req.query;
    if (!sessionToken) return ws.close(4001, "Missing sessionToken");

    const session = await Session.findOne({ where: { token: sessionToken } });
    if (!session) return ws.close(4003, "Invalid session");

    await Session.update({ lastActivity: new Date() }, { where: { id: session.id } });

    const user = await Account.findByPk(session.accountId);
    if (!user) return ws.close(4004, "Account not found");

    const conn = { ws, tabId: tabId || null, browserId: browserId || null, sessionId: session.id };
    stateBroadcaster.register(user.id, session.id, ws, tabId || null, browserId || null);
    stateBroadcaster.sendAllStateToConnection(user.id, conn).catch(() => {});

    const onMessage = async (msg) => {
        try {
            const { action, type } = JSON.parse(msg);
            if (action === "refresh") {
                type ? stateBroadcaster.sendStateToConnection(user.id, conn, type) : stateBroadcaster.sendAllStateToConnection(user.id, conn);
            } else if (type === STATE_TYPES.HEALTH_LIVE && action === "subscribe") {
                if (await hasSystemPermission(user.id, Permission.SERVER_HEALTH_VIEW)) healthService.addRealtimeViewer(ws, user.id);
            } else if (type === STATE_TYPES.HEALTH_LIVE && action === "unsubscribe") {
                healthService.removeRealtimeViewer(ws);
            }
        } catch {}
    };
    ws.off("message", queue);
    ws.on("message", onMessage);
    early.forEach(onMessage);

    const cleanup = () => {
        stateBroadcaster.unregister(user.id, ws);
        healthService.removeRealtimeViewer(ws);
    };
    ws.on("close", cleanup);
    ws.on("error", cleanup);
};
