const AVG_FIELDS = ["cpu", "iowait", "steal", "load1", "memUsed", "memTotal", "swapUsed", "diskUsed", "diskTotal", "diskRead", "diskWrite",
    "netRx", "netTx", "primaryMbps", "serverCpu", "serverRss", "engineCpu", "engineRss", "lagMs"];
const MAX_FIELDS = ["cpuMax", "primaryMbpsMax", "lagP99Ms", "sessions", "activeSessions", "guacSessions", "terminalSessions", "users", "viewers"];
const FALLBACK = { cpuMax: "cpu", primaryMbpsMax: "primaryMbps" };

const round = (value, digits = 2) => {
    const f = 10 ** digits;
    return Math.round((Number(value) || 0) * f) / f;
};

const isConnected = (row) => Boolean(row.engineConnected ?? true);

// Live 15-second samples have no *Max fields; they fall back to the plain value.
const toPoint = (row) => {
    const point = { t: new Date(row.timestamp).toISOString(), engineConnected: isConnected(row) };
    for (const key of [...AVG_FIELDS, ...MAX_FIELDS]) point[key] = round(row[key] ?? row[FALLBACK[key]] ?? 0);
    return point;
};

// Averages load figures and keeps the peaks of *Max fields and session counts.
const aggregate = (items, timestamp) => {
    const result = { timestamp: new Date(timestamp), engineConnected: items.every(isConnected) };
    for (const f of AVG_FIELDS) result[f] = items.reduce((s, i) => s + (Number(i[f]) || 0), 0) / items.length;
    for (const f of MAX_FIELDS) result[f] = items.reduce((m, i) => Math.max(m, Number(i[f] ?? i[FALLBACK[f]]) || 0), 0);
    return result;
};

const bucketRows = (rows, bucketMinutes) => {
    if (bucketMinutes <= 1) return rows.map(toPoint);
    const size = bucketMinutes * 60000;
    const buckets = new Map();
    for (const row of rows) {
        const key = Math.floor(new Date(row.timestamp).getTime() / size) * size;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(row);
    }
    return [...buckets.entries()].map(([key, items]) => toPoint(aggregate(items, key)));
};

// Weekday x hour grid in the viewer's time zone (tzOffset = Date.getTimezoneOffset() of the viewer).
const buildHeatmap = (rows, tzOffset) => {
    const cells = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ sum: 0, count: 0, peak: 0 })));
    for (const row of rows) {
        const local = new Date(new Date(row.timestamp).getTime() - tzOffset * 60000);
        const cell = cells[local.getUTCDay()][local.getUTCHours()];
        cell.sum += row.sessions;
        cell.count++;
        cell.peak = Math.max(cell.peak, row.sessions);
    }
    return cells.map((day) => day.map((c) => ({ avg: c.count ? round(c.sum / c.count) : null, peak: c.peak })));
};

module.exports = { round, toPoint, aggregate, bucketRows, buildHeatmap };
