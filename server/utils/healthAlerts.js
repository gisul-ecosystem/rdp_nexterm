const pct = (used, total) => (total > 0 ? (used / total) * 100 : null);

// Thresholds are "at or above" except for lowerIsWorse rules. minutes = how long the condition must hold.
const RULES = {
    cpu: { label: "CPU usage", unit: "%", defaults: { enabled: true, warning: 80, critical: 90, minutes: 5 }, value: (s) => s.cpu },
    memory: { label: "Memory usage", unit: "%", defaults: { enabled: true, warning: 85, critical: 95, minutes: 5 }, value: (s) => pct(s.memUsed, s.memTotal) },
    disk: { label: "Disk usage", unit: "%", defaults: { enabled: true, warning: 85, critical: 95, minutes: 1 }, value: (s) => pct(s.diskUsed, s.diskTotal) },
    bandwidth: {
        label: "Network bandwidth", unit: "% of link", defaults: { enabled: true, warning: 70, critical: 90, minutes: 5 },
        value: (s, ctx) => (ctx.linkMbps ? (s.primaryMbps / ctx.linkMbps) * 100 : null),
    },
    steal: { label: "CPU steal (hypervisor busy)", unit: "%", defaults: { enabled: true, warning: 10, critical: 20, minutes: 5 }, value: (s) => s.steal },
    lag: { label: "Server response delay (p99)", unit: " ms", defaults: { enabled: true, warning: 200, critical: 500, minutes: 2 }, value: (s) => s.lagP99Ms },
    capacity: {
        label: "Free remote desktop capacity", unit: " sessions", lowerIsWorse: true,
        defaults: { enabled: true, warning: 3, critical: 1, minutes: 5 },
        value: (s, ctx) => (["medium", "high"].includes(ctx.capacity?.confidence) ? ctx.capacity.headroom : null),
    },
    engine: {
        label: "Connection engine offline", unit: " s", criticalOnly: true,
        defaults: { enabled: true, critical: 30, minutes: 0 }, value: (s, ctx) => ctx.engineDownSeconds,
    },
};

const RECOVER_MS = 60 * 1000;
const RANK = { ok: 0, warning: 1, critical: 2 };

const ruleConfig = (key, overrides = {}) => ({ ...RULES[key].defaults, ...(overrides?.[key] || {}) });

const levelOf = (rule, cfg, value) => {
    if (value === null || value === undefined || Number.isNaN(value)) return "ok";
    const breaches = (threshold) => threshold !== null && threshold !== undefined
        && (rule.lowerIsWorse ? value <= threshold : value >= threshold);
    if (breaches(cfg.critical)) return "critical";
    if (!rule.criticalOnly && breaches(cfg.warning)) return "warning";
    return "ok";
};

const worse = (rule, a, b) => (rule.lowerIsWorse ? Math.min(a, b) : Math.max(a, b));

/**
 * Turns a stream of samples into alerts. store: { create(data) -> alert, update(id, changes) };
 * notify(event, alert) with event fired | escalated | resolved.
 */
class AlertEvaluator {
    constructor({ store, notify, now = Date.now }) {
        this.store = store;
        this.notify = notify;
        this.now = now;
        this.state = new Map(Object.keys(RULES).map((key) => [key, { since: { warning: null, critical: null }, okSince: null, alert: null }]));
    }

    load(activeAlerts) {
        for (const alert of activeAlerts) {
            const st = this.state.get(alert.rule);
            if (st && !st.alert) st.alert = { ...alert };
        }
    }

    activeAlerts() {
        return [...this.state.values()].map((st) => st.alert).filter(Boolean);
    }

    async evaluate(sample, context, overrides) {
        for (const key of Object.keys(RULES)) await this.evaluateRule(key, sample, context, overrides);
    }

    async evaluateRule(key, sample, context, overrides) {
        const rule = RULES[key];
        const cfg = ruleConfig(key, overrides);
        const st = this.state.get(key);
        const t = this.now();
        const value = cfg.enabled ? rule.value(sample, context) : null;

        if (value === null || value === undefined) {
            st.since = { warning: null, critical: null };
            st.okSince = null;
            if (st.alert) await this.resolve(key, st.alert.value);
            return;
        }

        const level = levelOf(rule, cfg, value);
        st.since.critical = level === "critical" ? (st.since.critical ?? t) : null;
        st.since.warning = level !== "ok" ? (st.since.warning ?? t) : null;

        const hold = (cfg.minutes || 0) * 60 * 1000;
        const held = (since) => since !== null && t - since >= hold;
        const reached = held(st.since.critical) ? "critical" : !rule.criticalOnly && held(st.since.warning) ? "warning" : null;

        if (st.alert) {
            st.alert.value = value;
            st.alert.peakValue = worse(rule, st.alert.peakValue ?? value, value);
            if (reached && RANK[reached] > RANK[st.alert.severity]) {
                Object.assign(st.alert, { severity: reached, threshold: cfg[reached] });
                await this.store.update(st.alert.id, { severity: reached, threshold: cfg[reached], value, peakValue: st.alert.peakValue });
                await this.notify("escalated", st.alert);
            }
            st.okSince = level === "ok" ? (st.okSince ?? t) : null;
            if (st.okSince !== null && t - st.okSince >= RECOVER_MS) await this.resolve(key, value);
            return;
        }

        if (reached) {
            const since = st.since[reached] ?? st.since.warning ?? t;
            st.okSince = null;
            st.alert = await this.store.create({
                rule: key, severity: reached, status: "active", value, peakValue: value,
                threshold: cfg[reached], startedAt: new Date(since),
            });
            await this.notify("fired", st.alert);
        }
    }

    async resolve(key, value) {
        const st = this.state.get(key);
        const alert = st.alert;
        st.alert = null;
        st.okSince = null;
        const changes = { status: "resolved", resolvedAt: new Date(this.now()), value: value ?? alert.value, peakValue: alert.peakValue };
        Object.assign(alert, changes);
        await this.store.update(alert.id, changes);
        await this.notify("resolved", alert);
    }
}

const formatValue = (rule, value) => {
    if (value === null || value === undefined) return "n/a";
    const rounded = Math.abs(value) >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
    return `${rounded}${rule.unit}`;
};

const minutesBetween = (from, to) => Math.max(1, Math.round((new Date(to) - new Date(from)) / 60000));

const alertText = (event, alert, serverLabel = "Nexterm") => {
    if (event === "test") return `[TEST] ${serverLabel}: alert notifications are working.`;
    const rule = RULES[alert.rule] || { label: alert.rule, unit: "" };
    if (event === "resolved") {
        return `[RESOLVED] ${serverLabel}: ${rule.label} is back to normal (now ${formatValue(rule, alert.value)}, `
            + `worst ${formatValue(rule, alert.peakValue)}, lasted ${minutesBetween(alert.startedAt, alert.resolvedAt)} min).`;
    }
    const verb = event === "escalated" ? "is now" : "is";
    const cmp = rule.lowerIsWorse ? "at or below" : "at or above";
    return `[${alert.severity.toUpperCase()}] ${serverLabel}: ${rule.label} ${verb} ${formatValue(rule, alert.value)} `
        + `(${cmp} ${formatValue(rule, alert.threshold)} since ${new Date(alert.startedAt).toISOString().slice(11, 16)} UTC).`;
};

const WEBHOOK_FORMATS = ["generic", "slack", "teams", "googlechat"];

const webhookPayload = (format, event, alert, serverLabel) => {
    const text = alertText(event, alert, serverLabel);
    if (format === "slack" || format === "googlechat") return { text };
    if (format === "teams") {
        const color = event === "resolved" || event === "test" ? "Good" : alert?.severity === "critical" ? "Attention" : "Warning";
        return {
            type: "message",
            attachments: [{
                contentType: "application/vnd.microsoft.card.adaptive",
                content: {
                    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
                    type: "AdaptiveCard",
                    version: "1.4",
                    body: [
                        { type: "TextBlock", text: `${serverLabel} server health`, weight: "Bolder", size: "Medium", color },
                        { type: "TextBlock", text, wrap: true },
                    ],
                },
            }],
        };
    }
    return {
        event,
        server: serverLabel,
        text,
        alert: alert && {
            id: alert.id, rule: alert.rule, label: RULES[alert.rule]?.label, severity: alert.severity, status: alert.status,
            value: alert.value, peakValue: alert.peakValue, threshold: alert.threshold,
            startedAt: alert.startedAt, resolvedAt: alert.resolvedAt || null,
        },
    };
};

const sendWebhook = async (url, format, event, alert, serverLabel) => {
    const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(webhookPayload(format, event, alert, serverLabel)),
        signal: AbortSignal.timeout(10000),
        redirect: "error",
    });
    if (!res.ok) throw new Error(`Webhook answered ${res.status}`);
};

module.exports = { RULES, RECOVER_MS, WEBHOOK_FORMATS, AlertEvaluator, ruleConfig, levelOf, alertText, webhookPayload, sendWebhook };
