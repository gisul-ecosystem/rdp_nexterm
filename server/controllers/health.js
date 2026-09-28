const { Op } = require("sequelize");
const packageJson = require("../../package.json");
const logger = require("../utils/logger");
const healthService = require("../utils/healthService");
const { RULES, ruleConfig, sendWebhook } = require("../utils/healthAlerts");
const HealthSample = require("../models/HealthSample");
const HealthDaily = require("../models/HealthDaily");
const HealthAlert = require("../models/HealthAlert");
const HealthSettings = require("../models/HealthSettings");
const Account = require("../models/Account");
const SessionManager = require("../lib/SessionManager");
const controlPlane = require("../lib/controlPlane/ControlPlaneServer");
const { loadNames, collectIds, liveState, protocolOfEntry } = require("./usage");
const { round, toPoint, bucketRows, buildHeatmap } = require("../utils/healthSeries");

const RANGES = {
    "6h": { ms: 6 * 3600e3, bucketMinutes: 1 },
    "24h": { ms: 24 * 3600e3, bucketMinutes: 4 },
    "7d": { ms: 7 * 86400e3, bucketMinutes: 30 },
    "30d": { ms: 30 * 86400e3, bucketMinutes: 120 },
};
const SPARKLINE_POINTS = 60;
const HEATMAP_DAYS = 28;
const DAILY_DAYS = 30;

const overallStatus = (alerts) => alerts.some((a) => a.severity === "critical") ? "critical" : alerts.length ? "warning" : "ok";

const withAcknowledger = async (alerts) => {
    const ids = [...new Set(alerts.map((a) => a.acknowledgedBy).filter(Boolean))];
    const accounts = ids.length ? await Account.findAll({ where: { id: ids }, attributes: ["id", "username"] }) : [];
    const names = new Map(accounts.map((a) => [a.id, a.username]));
    return alerts.map((a) => ({ ...a, acknowledgedByName: a.acknowledgedBy ? names.get(a.acknowledgedBy) || null : null }));
};

const liveSessions = async () => {
    const sessions = SessionManager.listAll();
    const names = await loadNames(collectIds(sessions, (s) => ({ accountId: s.accountId, entryId: Number(s.entryId) })));
    const traffic = healthService.getSessionTraffic();
    return sessions.map((s) => {
        const entry = names.entries.get(Number(s.entryId));
        const t = traffic.get(s.sessionId) || { inRate: 0, outRate: 0 };
        return {
            sessionId: s.sessionId,
            user: names.accounts.get(s.accountId) || { id: s.accountId },
            entryId: Number(s.entryId),
            entryName: entry?.name || null,
            protocol: s.configuration?.renderer === "sftp" ? "sftp" : protocolOfEntry(entry),
            startedAt: s.createdAt,
            state: liveState(s),
            viewers: s.connectedWs.size,
            bytesIn: s.bytesIn,
            bytesOut: s.bytesOut,
            inRate: round(t.inRate),
            outRate: round(t.outRate),
        };
    }).sort((a, b) => (b.inRate + b.outRate) - (a.inRate + a.outRate) || new Date(a.startedAt) - new Date(b.startedAt));
};

const getLive = async () => {
    try {
        const settings = await healthService.getSettings();
        const live = healthService.getLive();
        const latest = live.at(-1) || null;
        const capacity = latest ? await healthService.refreshCapacity(settings) : null;
        const alerts = await withAcknowledger(healthService.getActiveAlerts());
        return {
            now: new Date().toISOString(),
            ready: !!latest,
            status: overallStatus(alerts),
            sample: latest && { ...toPoint(latest), interfaces: latest.interfaces, engineProcesses: latest.engineProcesses },
            recent: live.slice(-SPARKLINE_POINTS).map(toPoint),
            host: {
                ...healthService.getHost(),
                linkMbps: healthService.linkMbpsOf(settings),
                linkMbpsConfigured: !!settings.linkMbps,
                primaryInterface: healthService.primaryInterfaceOf(settings),
                serverLabel: settings.serverLabel || "Nexterm",
            },
            nexterm: { version: packageJson.version, uptime: Math.round(process.uptime()), engineConnected: controlPlane.hasEngine() },
            sessions: await liveSessions(),
            capacity,
            alerts,
            rules: Object.fromEntries(Object.keys(RULES).map((key) => [key, ruleConfig(key, settings.rules)])),
            sampleIntervalSeconds: healthService.SAMPLE_MS / 1000,
        };
    } catch (error) {
        logger.error("Error loading live server health", { error: error.message });
        return { code: 500, message: "Failed to load server health" };
    }
};

const getHistory = async ({ range }) => {
    try {
        if (range === "1h") return { range, bucketSeconds: healthService.SAMPLE_MS / 1000, points: healthService.getLive().map(toPoint) };
        const { ms, bucketMinutes } = RANGES[range];
        const rows = await HealthSample.findAll({
            where: { timestamp: { [Op.gte]: new Date(Date.now() - ms) } },
            order: [["timestamp", "ASC"]],
            raw: true,
        });
        return { range, bucketSeconds: bucketMinutes * 60, points: bucketRows(rows, bucketMinutes) };
    } catch (error) {
        logger.error("Error loading server health history", { error: error.message });
        return { code: 500, message: "Failed to load server health history" };
    }
};

const getCapacity = async ({ tzOffset }) => {
    try {
        const settings = await healthService.getSettings();
        const since = new Date(Date.now() - HEATMAP_DAYS * 86400000);
        const [capacity, daily, rows] = await Promise.all([
            healthService.refreshCapacity(settings),
            HealthDaily.findAll({
                where: { day: { [Op.gte]: new Date(Date.now() - DAILY_DAYS * 86400000).toISOString().slice(0, 10) } },
                order: [["day", "ASC"]],
                raw: true,
            }),
            HealthSample.findAll({ where: { timestamp: { [Op.gte]: since } }, attributes: ["timestamp", "sessions"], raw: true }),
        ]);
        return {
            capacity,
            linkMbps: healthService.linkMbpsOf(settings),
            daily: daily.map((d) => ({ ...d, avgCpu: round(d.avgCpu), peakCpu: round(d.peakCpu), peakMemPct: round(d.peakMemPct), peakNetMbps: round(d.peakNetMbps), peakLagMs: round(d.peakLagMs) })),
            heatmap: buildHeatmap(rows, tzOffset),
            heatmapDays: HEATMAP_DAYS,
        };
    } catch (error) {
        logger.error("Error loading server capacity", { error: error.message });
        return { code: 500, message: "Failed to load capacity" };
    }
};

const listAlerts = async ({ status, limit, offset }) => {
    try {
        const where = status ? { status } : {};
        const { rows, count } = await HealthAlert.findAndCountAll({ where, order: [["startedAt", "DESC"]], limit, offset, raw: true });
        return { alerts: await withAcknowledger(rows), total: count };
    } catch (error) {
        logger.error("Error listing server health alerts", { error: error.message });
        return { code: 500, message: "Failed to load alerts" };
    }
};

const acknowledgeAlert = async (accountId, id) => {
    const alert = await HealthAlert.findByPk(id);
    if (!alert) return { code: 404, message: "Alert not found" };
    if (alert.status !== "active") return { code: 409, message: "Alert is already resolved" };
    if (alert.acknowledgedAt) return { message: "Alert already acknowledged" };
    const acknowledgedAt = new Date();
    await HealthAlert.update({ acknowledgedAt, acknowledgedBy: accountId }, { where: { id } });
    healthService.markAcknowledged(id, acknowledgedAt, accountId);
    await healthService.pushActiveAlerts();
    return { message: "Alert acknowledged" };
};

const webhookHost = (url) => {
    try { return new URL(url).host; } catch { return null; }
};

const settingsView = async (settings) => {
    const host = healthService.getHost() || {};
    const url = healthService.decryptWebhookUrl(settings.webhookUrl);
    return {
        serverLabel: settings.serverLabel || "",
        linkMbps: settings.linkMbps,
        detectedLinkMbps: host.detectedLinkMbps || null,
        primaryInterface: settings.primaryInterface || "",
        defaultInterface: host.defaultInterface || null,
        interfaces: Object.keys(healthService.getLive().at(-1)?.interfaces || {}),
        rules: Object.fromEntries(Object.keys(RULES).map((key) => [key, ruleConfig(key, settings.rules)])),
        ruleMeta: Object.fromEntries(Object.entries(RULES).map(([key, r]) => [key, { lowerIsWorse: !!r.lowerIsWorse, criticalOnly: !!r.criticalOnly }])),
        webhookEnabled: settings.webhookEnabled,
        webhookFormat: settings.webhookFormat,
        webhookConfigured: !!url,
        webhookHost: url ? webhookHost(url) : null,
        notifyResolved: settings.notifyResolved,
        retentionDays: settings.retentionDays,
        webhookStatus: healthService.getWebhookStatus(),
    };
};

const getSettings = async () => {
    try {
        return await settingsView(await healthService.getSettings());
    } catch (error) {
        logger.error("Error loading server health settings", { error: error.message });
        return { code: 500, message: "Failed to load settings" };
    }
};

const thresholdsInOrder = (key, cfg) => {
    const rule = RULES[key];
    if (rule.criticalOnly || cfg.warning === null || cfg.warning === undefined) return true;
    return rule.lowerIsWorse ? cfg.warning > cfg.critical : cfg.warning < cfg.critical;
};

const updateSettings = async (body) => {
    try {
        const current = await healthService.getSettings();
        const changes = {};

        if (body.rules) {
            const rules = { ...(current.rules || {}) };
            for (const [key, value] of Object.entries(body.rules)) {
                const merged = { ...ruleConfig(key, current.rules), ...value };
                if (!thresholdsInOrder(key, merged)) {
                    const order = RULES[key].lowerIsWorse ? "above" : "below";
                    return { code: 400, message: `${RULES[key].label}: the warning level must be ${order} the critical level` };
                }
                rules[key] = merged;
            }
            changes.rules = rules;
        }
        for (const key of ["linkMbps", "webhookEnabled", "webhookFormat", "notifyResolved", "retentionDays"]) {
            if (body[key] !== undefined) changes[key] = body[key];
        }
        if (body.serverLabel !== undefined) changes.serverLabel = body.serverLabel || null;
        if (body.primaryInterface !== undefined) changes.primaryInterface = body.primaryInterface || null;
        if (body.webhookUrl !== undefined) changes.webhookUrl = healthService.encryptWebhookUrl(body.webhookUrl || null);

        const willHaveUrl = changes.webhookUrl !== undefined ? !!changes.webhookUrl : !!current.webhookUrl;
        if ((changes.webhookEnabled ?? current.webhookEnabled) && !willHaveUrl) {
            return { code: 400, message: "Enter a webhook URL before turning notifications on" };
        }

        await HealthSettings.update(changes, { where: { id: current.id } });
        const settings = await healthService.loadSettings();
        await healthService.refreshCapacity(settings, true);
        return await settingsView(settings);
    } catch (error) {
        logger.error("Error updating server health settings", { error: error.message });
        return { code: 500, message: "Failed to save settings" };
    }
};

const testWebhook = async (body) => {
    const settings = await healthService.getSettings();
    try {
        if (body.webhookUrl) {
            await sendWebhook(body.webhookUrl, body.webhookFormat || settings.webhookFormat, "test", null, settings.serverLabel || "Nexterm");
        } else {
            await healthService.deliverWebhook("test", null, { ...settings, webhookFormat: body.webhookFormat || settings.webhookFormat });
        }
        return { message: "Test notification sent" };
    } catch (error) {
        return { code: 502, message: `Test notification failed: ${error.message}` };
    }
};

module.exports = { getLive, getHistory, getCapacity, listAlerts, acknowledgeAlert, getSettings, updateSettings, testWebhook };
