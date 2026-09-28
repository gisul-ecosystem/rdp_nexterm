const path = require("node:path");
const { monitorEventLoopDelay } = require("node:perf_hooks");
const { Op } = require("sequelize");
const logger = require("./logger");
const hostMetrics = require("./hostMetrics");
const { estimateCapacity } = require("./healthCapacity");
const { aggregate } = require("./healthSeries");
const { AlertEvaluator, sendWebhook } = require("./healthAlerts");
const { encrypt, decrypt } = require("./encryption");
const HealthSample = require("../models/HealthSample");
const HealthDaily = require("../models/HealthDaily");
const HealthAlert = require("../models/HealthAlert");
const HealthSettings = require("../models/HealthSettings");
const SessionManager = require("../lib/SessionManager");
const controlPlane = require("../lib/controlPlane/ControlPlaneServer");
const stateBroadcaster = require("../lib/StateBroadcaster");

const SAMPLE_MS = 15 * 1000;
const LIVE_POINTS = 240;
const CAPACITY_WINDOW_DAYS = 7;
const CAPACITY_REFRESH_MS = 5 * 60 * 1000;
const DAILY_RETENTION_DAYS = 400;
const DATA_PATH = path.join(__dirname, "../../data");

let timer = null;
let cleanupTimer = null;
let lagMonitor = null;
let prev = null;
let host = null;
let settingsCache = null;
let minuteBucket = [];
let capacity = null;
let capacityAt = 0;
let engineDownSince = null;
let webhookStatus = { lastSentAt: null, lastError: null };
const live = [];
const sessionTraffic = new Map();

const evaluator = new AlertEvaluator({
    store: {
        create: async (data) => (await HealthAlert.create(data)).get({ plain: true }),
        update: (id, changes) => HealthAlert.update(changes, { where: { id } }),
    },
    notify: (event, alert) => notify(event, alert),
});

const loadSettings = async () => {
    let row = await HealthSettings.findOne({ order: [["id", "ASC"]] });
    if (!row) row = await HealthSettings.create({});
    settingsCache = row.get({ plain: true });
    settingsCache.rules = row.rules || {};
    return settingsCache;
};

const getSettings = async () => settingsCache || loadSettings();

const decryptWebhookUrl = (stored) => {
    if (!stored) return null;
    try {
        const { encrypted, iv, authTag } = JSON.parse(stored);
        return decrypt(encrypted, iv, authTag);
    } catch {
        return null;
    }
};

const encryptWebhookUrl = (url) => (url ? JSON.stringify(encrypt(url)) : null);

const linkMbpsOf = (settings) => settings?.linkMbps || host?.detectedLinkMbps || null;
const primaryInterfaceOf = (settings) => settings?.primaryInterface || host?.defaultInterface || null;
const serverLabelOf = (settings) => settings?.serverLabel || "Nexterm";

const recipientsWithHealthView = async () => {
    const { hasSystemPermission } = require("../permissions/engine");
    const { Permission } = require("../permissions/registry");
    const ids = [...stateBroadcaster.connections.keys()];
    const allowed = await Promise.all(ids.map((id) => hasSystemPermission(id, Permission.SERVER_HEALTH_VIEW)));
    return ids.filter((_, i) => allowed[i]);
};

const pushActiveAlerts = async () => {
    try {
        stateBroadcaster.push(await recipientsWithHealthView(), "HEALTH_ALERTS", evaluator.activeAlerts());
    } catch (error) {
        logger.error("Could not push health alerts", { error: error.message });
    }
};

const deliverWebhook = async (event, alert, settings = settingsCache) => {
    const url = decryptWebhookUrl(settings?.webhookUrl);
    if (!url) throw new Error("No webhook URL configured");
    await sendWebhook(url, settings.webhookFormat, event, alert, serverLabelOf(settings));
};

const notify = async (event, alert) => {
    logger[event === "resolved" ? "info" : "warn"](`Server health alert ${event}`, { rule: alert.rule, severity: alert.severity, value: alert.value });
    await pushActiveAlerts();

    const settings = settingsCache;
    if (!settings?.webhookEnabled || (event === "resolved" && !settings.notifyResolved)) return;
    deliverWebhook(event, alert, settings)
        .then(() => { webhookStatus = { lastSentAt: new Date().toISOString(), lastError: null }; })
        .catch((error) => {
            webhookStatus = { ...webhookStatus, lastError: error.message };
            logger.error("Server health webhook failed", { error: error.message });
        });
};

const rate = (next, before, seconds) => (next >= before ? (next - before) / seconds : 0);

const collectSessions = (seconds) => {
    const list = SessionManager.listAll();
    const seen = new Set();
    const counts = { sessions: 0, activeSessions: 0, guacSessions: 0, terminalSessions: 0, viewers: 0 };
    const users = new Set();

    for (const s of list) {
        seen.add(s.sessionId);
        const renderer = s.configuration?.renderer;
        counts.sessions++;
        if (renderer === "guac") counts.guacSessions++;
        else if (renderer === "terminal") counts.terminalSessions++;
        if (!s.isHibernated && s.connectedWs.size > 0) counts.activeSessions++;
        counts.viewers += s.connectedWs.size;
        users.add(s.accountId);

        const last = sessionTraffic.get(s.sessionId);
        sessionTraffic.set(s.sessionId, {
            bytesIn: s.bytesIn,
            bytesOut: s.bytesOut,
            inRate: last && seconds ? rate(s.bytesIn, last.bytesIn, seconds) : 0,
            outRate: last && seconds ? rate(s.bytesOut, last.bytesOut, seconds) : 0,
        });
    }
    for (const id of sessionTraffic.keys()) if (!seen.has(id)) sessionTraffic.delete(id);
    return { ...counts, users: users.size };
};

const buildSample = (snap, before, settings) => {
    const seconds = (snap.at - before.at) / 1000;
    const cpu = hostMetrics.cpuPercentages(before.cpuTimes, snap.cpuTimes) || { cpu: 0, iowait: 0, steal: 0 };

    let netRx = 0, netTx = 0;
    const interfaces = {};
    for (const [name, counters] of Object.entries(snap.net)) {
        const old = before.net[name];
        if (!old) continue;
        const rx = rate(counters.rx, old.rx, seconds);
        const tx = rate(counters.tx, old.tx, seconds);
        interfaces[name] = { rx, tx };
        netRx += rx;
        netTx += tx;
    }
    const primary = interfaces[primaryInterfaceOf(settings)] || { rx: netRx, tx: netTx };

    // Process CPU as a share of the whole VM, comparable with the host CPU figure.
    const procCpu = (next, old) => Math.max(0, ((next - old) / hostMetrics.CLOCK_TICKS / seconds / (host.cpus || 1)) * 100);
    const lagMs = lagMonitor ? lagMonitor.mean / 1e6 : 0;
    const lagP99Ms = lagMonitor ? lagMonitor.percentile(99) / 1e6 : 0;
    lagMonitor?.reset();

    const engineConnected = controlPlane.hasEngine();
    engineDownSince = engineConnected ? null : (engineDownSince ?? snap.at);

    return {
        timestamp: new Date(snap.at),
        cpu: cpu.cpu,
        iowait: cpu.iowait,
        steal: cpu.steal,
        load1: snap.load.load1,
        memUsed: snap.memory.memUsed,
        memTotal: snap.memory.memTotal,
        swapUsed: snap.memory.swapUsed,
        diskUsed: Math.max(snap.dataDisk.used, 0),
        diskTotal: snap.dataDisk.total,
        diskRead: rate(snap.disk.readBytes, before.disk.readBytes, seconds),
        diskWrite: rate(snap.disk.writeBytes, before.disk.writeBytes, seconds),
        netRx,
        netTx,
        primaryMbps: (Math.max(primary.rx, primary.tx) * 8) / 1e6,
        serverCpu: procCpu(snap.processes.server.cpuTicks, before.processes.server.cpuTicks),
        serverRss: snap.processes.server.rss,
        engineCpu: procCpu(snap.processes.engine.cpuTicks, before.processes.engine.cpuTicks),
        engineRss: snap.processes.engine.rss,
        engineProcesses: snap.processes.engine.processes,
        lagMs,
        lagP99Ms,
        engineConnected,
        interfaces,
        ...collectSessions(seconds),
    };
};

const updateDaily = async (minute) => {
    const day = minute.timestamp.toISOString().slice(0, 10);
    const memPct = minute.memTotal ? (minute.memUsed / minute.memTotal) * 100 : 0;
    const row = await HealthDaily.findByPk(day);
    if (!row) {
        await HealthDaily.create({
            day, peakSessions: minute.sessions, peakUsers: minute.users, avgCpu: minute.cpu, peakCpu: minute.cpuMax,
            peakMemPct: memPct, peakNetMbps: minute.primaryMbpsMax, peakLagMs: minute.lagP99Ms, minutes: 1,
        });
        return;
    }
    await row.update({
        peakSessions: Math.max(row.peakSessions, minute.sessions),
        peakUsers: Math.max(row.peakUsers, minute.users),
        avgCpu: (row.avgCpu * row.minutes + minute.cpu) / (row.minutes + 1),
        peakCpu: Math.max(row.peakCpu, minute.cpuMax),
        peakMemPct: Math.max(row.peakMemPct, memPct),
        peakNetMbps: Math.max(row.peakNetMbps, minute.primaryMbpsMax),
        peakLagMs: Math.max(row.peakLagMs, minute.lagP99Ms),
        minutes: row.minutes + 1,
    });
};

const flushMinute = async () => {
    if (!minuteBucket.length) return;
    const samples = minuteBucket;
    minuteBucket = [];
    const minuteStart = Math.floor(samples[0].timestamp.getTime() / 60000) * 60000;
    try {
        const minute = aggregate(samples, minuteStart);
        await HealthSample.create(minute);
        await updateDaily(minute);
        for (const alert of evaluator.activeAlerts()) {
            await HealthAlert.update({ value: alert.value, peakValue: alert.peakValue }, { where: { id: alert.id } });
        }
    } catch (error) {
        logger.error("Could not store server health sample", { error: error.message });
    }
};

const refreshCapacity = async (settings, force = false) => {
    if (!force && capacity && Date.now() - capacityAt < CAPACITY_REFRESH_MS) return capacity;
    const since = new Date(Date.now() - CAPACITY_WINDOW_DAYS * 86400000);
    const rows = await HealthSample.findAll({
        where: { timestamp: { [Op.gte]: since } },
        attributes: ["cpu", "memUsed", "memTotal", "primaryMbps", "guacSessions", "engineConnected"],
        order: [["timestamp", "ASC"]],
        raw: true,
    });
    capacity = estimateCapacity(rows, linkMbpsOf(settings), live.at(-1)?.guacSessions || 0);
    capacityAt = Date.now();
    return capacity;
};

const tick = async () => {
    try {
        const settings = await getSettings();
        const snap = hostMetrics.snapshot(DATA_PATH);
        const sample = buildSample(snap, prev, settings);
        prev = snap;

        live.push(sample);
        if (live.length > LIVE_POINTS) live.shift();

        const minute = Math.floor(sample.timestamp.getTime() / 60000);
        if (minuteBucket.length && Math.floor(minuteBucket[0].timestamp.getTime() / 60000) !== minute) await flushMinute();
        minuteBucket.push(sample);

        const cap = await refreshCapacity(settings);
        cap.currentSessions = sample.guacSessions;
        if (cap.maxSessions !== null) cap.headroom = Math.max(0, cap.maxSessions - sample.guacSessions);

        await evaluator.evaluate(sample, {
            linkMbps: linkMbpsOf(settings),
            capacity: cap,
            engineDownSeconds: engineDownSince ? (sample.timestamp.getTime() - engineDownSince) / 1000 : 0,
        }, settings.rules);
    } catch (error) {
        logger.error("Server health collection failed", { error: error.message });
    }
};

const cleanup = async () => {
    try {
        const settings = await getSettings();
        const cutoff = new Date(Date.now() - (settings.retentionDays || 30) * 86400000);
        const removed = await HealthSample.destroy({ where: { timestamp: { [Op.lt]: cutoff } } });
        const dayCutoff = new Date(Date.now() - DAILY_RETENTION_DAYS * 86400000).toISOString().slice(0, 10);
        await HealthDaily.destroy({ where: { day: { [Op.lt]: dayCutoff } } });
        await HealthAlert.destroy({ where: { status: "resolved", resolvedAt: { [Op.lt]: new Date(Date.now() - DAILY_RETENTION_DAYS * 86400000) } } });
        if (removed) logger.verbose(`Removed ${removed} expired server health samples`);
    } catch (error) {
        logger.error("Server health cleanup failed", { error: error.message });
    }
};

const start = async () => {
    if (timer) return;
    try {
        await loadSettings();
        host = hostMetrics.hostInfo();
        evaluator.load(await HealthAlert.findAll({ where: { status: "active" }, raw: true }));
    } catch (error) {
        logger.error("Could not start server health service", { error: error.message });
        return;
    }
    lagMonitor = monitorEventLoopDelay({ resolution: 20 });
    lagMonitor.enable();
    prev = hostMetrics.snapshot(DATA_PATH);
    logger.system("Starting server health service", { interval: SAMPLE_MS });
    timer = setInterval(tick, SAMPLE_MS);
    cleanupTimer = setInterval(cleanup, 60 * 60 * 1000);
    cleanup();
};

const stop = async () => {
    clearInterval(timer);
    clearInterval(cleanupTimer);
    timer = null;
    lagMonitor?.disable();
    await flushMinute();
};

module.exports = {
    start,
    stop,
    getSettings,
    loadSettings,
    decryptWebhookUrl,
    encryptWebhookUrl,
    deliverWebhook,
    linkMbpsOf,
    primaryInterfaceOf,
    refreshCapacity,
    pushActiveAlerts,
    getHost: () => host && { ...host, uptime: hostMetrics.readUptime() },
    getLive: () => live,
    getSessionTraffic: () => sessionTraffic,
    getActiveAlerts: () => evaluator.activeAlerts(),
    getWebhookStatus: () => webhookStatus,
    markAcknowledged: (id, acknowledgedAt, acknowledgedBy) => {
        const alert = evaluator.activeAlerts().find((a) => a.id === id);
        if (alert) Object.assign(alert, { acknowledgedAt, acknowledgedBy });
    },
    SAMPLE_MS,
};
