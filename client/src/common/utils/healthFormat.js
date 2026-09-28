const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"];

export const formatBytes = (bytes, digits = 1) => {
    if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return "–";
    let value = Math.max(0, bytes);
    let unit = 0;
    while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(digits)} ${BYTE_UNITS[unit]}`;
};

export const formatRate = (bytesPerSecond) => `${formatBytes(bytesPerSecond)}/s`;

export const bytesToMbps = (bytesPerSecond) => (bytesPerSecond * 8) / 1e6;

export const formatMbps = (mbps) => {
    if (mbps === null || mbps === undefined) return "–";
    if (mbps >= 1000) return `${(mbps / 1000).toFixed(1)} Gbit/s`;
    if (mbps >= 10) return `${Math.round(mbps)} Mbit/s`;
    if (mbps >= 0.1) return `${mbps.toFixed(1)} Mbit/s`;
    return `${Math.round(mbps * 1000)} kbit/s`;
};

export const formatPct = (value) => {
    if (value === null || value === undefined || Number.isNaN(value)) return "–";
    return `${value >= 10 || value === 0 ? Math.round(value) : value.toFixed(1)}%`;
};

export const formatMs = (ms) => {
    if (ms === null || ms === undefined) return "–";
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`;
    return `${ms >= 10 ? Math.round(ms) : ms.toFixed(1)} ms`;
};

export const formatUptime = (seconds) => {
    if (!seconds && seconds !== 0) return "–";
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (days) return `${days}d ${hours}h`;
    if (hours) return `${hours}h ${minutes}m`;
    return `${Math.max(1, minutes)}m`;
};

export const formatClock = (value) => {
    const date = new Date(value);
    const sameDay = date.toDateString() === new Date().toDateString();
    return sameDay
        ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

const RULE_FORMAT = {
    cpu: formatPct, memory: formatPct, disk: formatPct, bandwidth: formatPct, steal: formatPct,
    lag: formatMs,
    capacity: (v) => (v === null || v === undefined ? "–" : String(Math.round(v))),
    engine: (v) => (v === null || v === undefined ? "–" : `${Math.round(v)} s`),
};

export const formatRuleValue = (rule, value) => (RULE_FORMAT[rule] || String)(value);

export const pctOf = (used, total) => (total > 0 ? (used / total) * 100 : null);

// Level of a value against alert thresholds: "ok" | "warning" | "critical".
export const levelFor = (value, rule, lowerIsWorse = false) => {
    if (value === null || value === undefined || !rule?.enabled) return "ok";
    const breaches = (threshold) => threshold !== null && threshold !== undefined
        && (lowerIsWorse ? value <= threshold : value >= threshold);
    if (breaches(rule.critical)) return "critical";
    if (breaches(rule.warning)) return "warning";
    return "ok";
};
