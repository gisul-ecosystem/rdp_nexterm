import Icon from "@mdi/react";
import { mdiAccountMultiple, mdiCpu64Bit, mdiHarddisk, mdiMemory, mdiSpeedometer, mdiSwapVertical } from "@mdi/js";
import { useTranslation } from "react-i18next";
import { formatBytes, formatMbps, formatMs, formatPct, formatRate, levelFor, pctOf } from "@/common/utils/healthFormat.js";
import "./styles.sass";

const RADIUS = 26;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const clamp = (v) => Math.min(100, Math.max(0, v));

const Gauge = ({ pct, icon }) => (
    <div className="health-gauge">
        <svg viewBox="0 0 64 64" aria-hidden="true">
            <circle className="health-gauge-track" cx="32" cy="32" r={RADIUS} />
            {pct !== null && (
                <circle
                    className="health-gauge-value"
                    cx="32" cy="32" r={RADIUS}
                    strokeDasharray={CIRCUMFERENCE}
                    strokeDashoffset={CIRCUMFERENCE * (1 - clamp(pct) / 100)}
                />
            )}
        </svg>
        <Icon path={icon} size={0.85} />
    </div>
);

const Sparkline = ({ values, max }) => {
    if (values.length < 2) return <div className="health-sparkline health-sparkline--empty" />;
    const top = Math.max(max ?? 0, ...values, 1e-9);
    const points = values.map((v, i) => [(i / (values.length - 1)) * 100, 30 - (Math.max(0, v) / top) * 28]);
    const line = points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
    return (
        <svg className="health-sparkline" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
            <path className="health-sparkline-area" d={`${line} L100,30 L0,30 Z`} />
            <path className="health-sparkline-line" d={line} vectorEffect="non-scaling-stroke" />
        </svg>
    );
};

const MetricCard = ({ card }) => (
    <div className={`health-metric health-level-${card.level}`} title={card.hint}>
        <div className="health-metric-top">
            <Gauge pct={card.pct} icon={card.icon} />
            <div className="health-metric-body">
                <span className="health-metric-label">{card.label}</span>
                <span className="health-metric-value">{card.value}</span>
                {card.badge && <span className="health-metric-badge">{card.badge}</span>}
            </div>
        </div>
        <span className="health-metric-sub">{card.sub}</span>
        <Sparkline values={card.spark} max={card.sparkMax} />
    </div>
);

export const MetricCards = ({ live }) => {
    const { t } = useTranslation();
    const { sample: s, recent, rules, host, capacity } = live;
    const memPct = pctOf(s.memUsed, s.memTotal);
    const diskPct = pctOf(s.diskUsed, s.diskTotal);
    const linkPct = host.linkMbps ? pctOf(s.primaryMbps, host.linkMbps) : null;
    const lagLimit = rules.lag?.critical || 500;
    const maxSessions = capacity?.confidence && capacity.confidence !== "none" ? capacity.maxSessions : null;

    const cards = [
        {
            key: "cpu", icon: mdiCpu64Bit, label: t("health.metrics.cpu"),
            value: formatPct(s.cpu), pct: s.cpu, level: levelFor(s.cpu, rules.cpu),
            sub: t("health.metrics.cpuSub", { load: s.load1.toFixed(2), steal: formatPct(s.steal) }),
            spark: recent.map((p) => p.cpu), sparkMax: 100,
        },
        {
            key: "memory", icon: mdiMemory, label: t("health.metrics.memory"),
            value: formatPct(memPct), pct: memPct, level: levelFor(memPct, rules.memory),
            sub: t("health.metrics.memorySub", { used: formatBytes(s.memUsed), total: formatBytes(s.memTotal, 0) }),
            spark: recent.map((p) => pctOf(p.memUsed, p.memTotal) ?? 0), sparkMax: 100,
        },
        {
            key: "disk", icon: mdiHarddisk, label: t("health.metrics.disk"),
            value: formatPct(diskPct), pct: diskPct, level: levelFor(diskPct, rules.disk),
            sub: t("health.metrics.diskSub", { used: formatBytes(s.diskUsed), total: formatBytes(s.diskTotal, 0) }),
            spark: recent.map((p) => p.diskRead + p.diskWrite),
            hint: `${t("health.charts.series.read")} ${formatRate(s.diskRead)} · ${t("health.charts.series.write")} ${formatRate(s.diskWrite)}`,
        },
        {
            key: "network", icon: mdiSwapVertical, label: t("health.metrics.network"),
            value: formatMbps(s.primaryMbps), pct: linkPct,
            level: linkPct === null ? "neutral" : levelFor(linkPct, rules.bandwidth),
            badge: linkPct !== null ? t("health.metrics.networkOfLink", { pct: formatPct(linkPct) }) : null,
            sub: t("health.metrics.networkSub", { rx: formatRate(s.netRx), tx: formatRate(s.netTx) }),
            spark: recent.map((p) => p.primaryMbps), sparkMax: host.linkMbps || undefined,
        },
        {
            key: "sessions", icon: mdiAccountMultiple, label: t("health.metrics.sessions"),
            value: String(s.sessions), pct: maxSessions ? pctOf(s.guacSessions, maxSessions) : null,
            level: maxSessions ? levelFor(capacity.headroom, rules.capacity, true) : "neutral",
            badge: maxSessions ? `${s.guacSessions} / ~${maxSessions}` : null,
            sub: t("health.metrics.sessionsSub", { count: s.users, desktops: s.guacSessions }),
            spark: recent.map((p) => p.sessions),
        },
        {
            key: "responsiveness", icon: mdiSpeedometer, label: t("health.metrics.responsiveness"),
            value: formatMs(s.lagP99Ms), pct: pctOf(s.lagP99Ms, lagLimit), level: levelFor(s.lagP99Ms, rules.lag),
            sub: t("health.metrics.responsivenessSub", { avg: formatMs(s.lagMs) }),
            spark: recent.map((p) => p.lagP99Ms), sparkMax: rules.lag?.warning || undefined,
        },
    ];

    return (
        <section className="health-metrics" aria-label={t("health.metrics.last15")}>
            {cards.map((card) => <MetricCard key={card.key} card={card} />)}
        </section>
    );
};
