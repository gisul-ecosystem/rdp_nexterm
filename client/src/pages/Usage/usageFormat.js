import { UAParser } from "ua-parser-js";

export const formatDuration = (seconds) => {
    if (seconds === null || seconds === undefined) return "—";
    const s = Math.max(0, Math.round(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const rest = s % 60;
    if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
    if (m > 0) return `${m}m ${String(rest).padStart(2, "0")}s`;
    return `${rest}s`;
};

export const formatDateTime = (value) => {
    if (!value) return null;
    const date = new Date(value);
    return { date: date.toLocaleDateString(), time: date.toLocaleTimeString() };
};

export const userName = (user) =>
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.username || `#${user?.id}`;

export const machineName = (row, t) =>
    row.entryName || t("usage.table.deletedMachine", { id: row.entryId });

export const browserName = (userAgent) => {
    if (!userAgent || userAgent === "unknown") return null;
    const { browser, os } = new UAParser(userAgent).getResult();
    return [browser.name && `${browser.name} ${browser.major || ""}`.trim(), os.name].filter(Boolean).join(" · ") || null;
};

const REASON_COLORS = {
    user_disconnect: "blue",
    tab_closed: "gray",
    ws_close: "gray",
    view_closed: "gray",
    connection_lost: "orange",
    stale_timeout: "orange",
    server_restart: "orange",
    replaced: "purple",
    remote_closed: "cyan",
    expired: "gray",
    account_logout: "gray",
    entry_removed: "gray",
    connect_failed: "red",
    engine_lost: "red",
    admin_disconnect: "red",
};

export const reasonBadge = (reason, t) => ({
    color: REASON_COLORS[reason] || "gray",
    label: t(`usage.reasons.${reason}`, { defaultValue: reason }),
});

const DAY_MS = 24 * 60 * 60 * 1000;

export const RANGE_PRESETS = ["today", "7d", "30d", "90d", "all", "custom"];

export const DEFAULT_FILTERS = { range: "7d", customFrom: "", customTo: "", accountId: "", entryId: "", status: "" };

// Returns ISO strings for the API; custom ranges come from datetime-local inputs in local time.
export const rangeToDates = (range, customFrom, customTo) => {
    const now = new Date();
    if (range === "custom") {
        return {
            from: customFrom ? new Date(customFrom).toISOString() : undefined,
            to: customTo ? new Date(customTo).toISOString() : undefined,
        };
    }
    if (range === "all") return {};
    if (range === "today") {
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        return { from: start.toISOString() };
    }
    const days = Number.parseInt(range, 10);
    return { from: new Date(now.getTime() - days * DAY_MS).toISOString() };
};
