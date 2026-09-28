// Estimates how many remote desktop (RDP/VNC) sessions this host can carry, from minute samples.
// Terminal sessions are ignored: next to a graphical session they cost almost nothing.

const LIMITS = { cpu: 85, memory: 0.9, bandwidth: 0.8 };
const MIN_POINTS = 10;
const MAX_ESTIMATE = 999;

const median = (values) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

// Resource use with no sessions, and the extra use per session.
const fitCost = (points) => {
    const idle = points.filter((p) => p.x === 0).map((p) => p.y);
    const busy = points.filter((p) => p.x > 0);
    if (!busy.length) return null;

    const distinct = new Set(points.map((p) => p.x)).size;
    if (points.length >= MIN_POINTS && distinct >= 2) {
        const n = points.length;
        const mx = points.reduce((s, p) => s + p.x, 0) / n;
        const my = points.reduce((s, p) => s + p.y, 0) / n;
        const cov = points.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
        const varX = points.reduce((s, p) => s + (p.x - mx) ** 2, 0);
        const slope = cov / varX;
        if (slope > 0) return { baseline: Math.max(0, my - slope * mx), perSession: slope };
    }

    // Without idle samples at a single session level the idle load is unknown; counting it all as
    // session cost underestimates capacity, which is the safe side.
    const baseline = idle.length >= MIN_POINTS ? median(idle) : distinct >= 2 ? Math.min(...points.map((p) => p.y)) : 0;
    const perSession = median(busy.map((p) => (p.y - baseline) / p.x));
    return perSession > 0 ? { baseline, perSession } : null;
};

const confidenceOf = (busyPoints, maxObserved) => {
    if (!busyPoints) return "none";
    if (busyPoints < 30 || maxObserved < 3) return "low";
    if (maxObserved < 8) return "medium";
    return "high";
};

/**
 * @param samples minute samples (oldest first) with cpu, memUsed, memTotal, primaryMbps, guacSessions, engineConnected
 * @param linkMbps usable link speed, or null when unknown
 * @param currentSessions remote desktop sessions open right now
 */
const estimateCapacity = (samples, linkMbps, currentSessions) => {
    const usable = samples.filter((s) => Boolean(s.engineConnected ?? true) && s.memTotal > 0);
    const memTotal = usable.at(-1)?.memTotal || 0;
    const busyPoints = usable.filter((s) => s.guacSessions > 0).length;
    const maxObserved = usable.reduce((m, s) => Math.max(m, s.guacSessions), 0);

    const resources = [
        { key: "cpu", limit: LIMITS.cpu, y: (s) => s.cpu },
        { key: "memory", limit: memTotal * LIMITS.memory, y: (s) => s.memUsed },
        ...(linkMbps ? [{ key: "bandwidth", limit: linkMbps * LIMITS.bandwidth, y: (s) => s.primaryMbps }] : []),
    ];

    const perResource = {};
    for (const r of resources) {
        const cost = fitCost(usable.map((s) => ({ x: s.guacSessions, y: r.y(s) })));
        if (!cost) continue;
        const max = Math.floor((r.limit - cost.baseline) / cost.perSession);
        perResource[r.key] = {
            baseline: cost.baseline,
            perSession: cost.perSession,
            limit: r.limit,
            maxSessions: Math.max(0, Math.min(MAX_ESTIMATE, max)),
        };
    }

    const entries = Object.entries(perResource);
    if (!entries.length) {
        return { confidence: "none", currentSessions, maxObserved, busyPoints, perResource, maxSessions: null, headroom: null, bottleneck: null };
    }

    const [bottleneck, worst] = entries.reduce((a, b) => (b[1].maxSessions < a[1].maxSessions ? b : a));
    return {
        confidence: confidenceOf(busyPoints, maxObserved),
        currentSessions,
        maxObserved,
        busyPoints,
        perResource,
        maxSessions: worst.maxSessions,
        headroom: Math.max(0, worst.maxSessions - currentSessions),
        bottleneck,
    };
};

module.exports = { estimateCapacity, fitCost, LIMITS };
