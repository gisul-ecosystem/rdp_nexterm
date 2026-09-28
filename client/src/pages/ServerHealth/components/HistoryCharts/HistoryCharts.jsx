import { useMemo } from "react";
import Icon from "@mdi/react";
import { mdiChartLine, mdiChartTimelineVariantShimmer } from "@mdi/js";
import { useTranslation } from "react-i18next";
import TabSwitcher from "@/common/components/TabSwitcher";
import { bytesToMbps, formatBytes, formatMbps, formatMs, formatPct, formatRate } from "@/common/utils/healthFormat.js";
import { useChartTheme } from "../../chartTheme.js";
import { HealthChart } from "./HealthChart.jsx";
import "./styles.sass";

const RANGES = ["live", "1h", "6h", "24h", "7d", "30d"];
const formatCount = (v) => String(Math.round(v));

export const HistoryCharts = ({ range, onRangeChange, history, live }) => {
    const { t } = useTranslation();
    const theme = useChartTheme();
    const rulesKey = JSON.stringify(live.rules);
    const rules = useMemo(() => JSON.parse(rulesKey), [rulesKey]);
    const memTotal = live.sample.memTotal;
    const points = history?.range === range ? history.points : null;
    const longRange = range === "7d" || range === "30d";

    const charts = useMemo(() => {
        const s = (key) => t(`health.charts.series.${key}`);
        const threshold = (rule, scale = (v) => v) => rules[rule]?.enabled
            ? [
                rules[rule].warning != null && { label: t("health.settings.warning"), value: scale(rules[rule].warning), color: theme.warning },
                rules[rule].critical != null && { label: t("health.settings.critical"), value: scale(rules[rule].critical), color: theme.error },
            ].filter(Boolean)
            : [];
        const memScale = (pct) => (pct / 100) * memTotal;

        return [
            {
                key: "cpu", format: formatPct, max: 100, thresholds: threshold("cpu"),
                series: [
                    { label: s("cpu"), color: theme.primary, fill: true, value: (p) => (longRange ? p.cpuMax : p.cpu) },
                    { label: s("nexterm"), color: theme.violet, value: (p) => p.serverCpu + p.engineCpu },
                    { label: s("steal"), color: theme.amber, dashed: true, value: (p) => p.steal },
                ],
            },
            {
                key: "memory", format: (v) => formatBytes(v), max: memTotal, thresholds: threshold("memory", memScale),
                series: [
                    { label: s("memUsed"), color: theme.cyan, fill: true, value: (p) => p.memUsed },
                    { label: s("nextermMem"), color: theme.violet, value: (p) => p.serverRss + p.engineRss },
                ],
            },
            {
                key: "network", format: formatMbps,
                series: [
                    { label: s("rx"), color: theme.success, fill: true, value: (p) => bytesToMbps(p.netRx) },
                    { label: s("tx"), color: theme.primary, value: (p) => bytesToMbps(p.netTx) },
                ],
            },
            {
                key: "sessions", format: formatCount, stepped: true,
                series: [
                    { label: s("sessions"), color: theme.primary, fill: true, value: (p) => p.sessions },
                    { label: s("desktops"), color: theme.cyan, value: (p) => p.guacSessions },
                    { label: s("users"), color: theme.amber, dashed: true, value: (p) => p.users },
                ],
            },
            {
                key: "responsiveness", format: formatMs, thresholds: threshold("lag"),
                series: [
                    { label: s("p99"), color: theme.warning, fill: true, value: (p) => p.lagP99Ms },
                    { label: s("mean"), color: theme.primary, value: (p) => p.lagMs },
                ],
            },
            {
                key: "disk", format: formatRate,
                series: [
                    { label: s("read"), color: theme.cyan, fill: true, value: (p) => p.diskRead },
                    { label: s("write"), color: theme.violet, value: (p) => p.diskWrite },
                ],
            },
        ];
    }, [t, theme, rules, memTotal, longRange]);

    const tabs = RANGES.map((key) => ({ key, label: t(`health.charts.ranges.${key}`) }));

    return (
        <section className="health-history">
            <div className="health-section-header">
                <h3 className="health-section-title"><Icon path={mdiChartLine} size={0.85} />{t("health.charts.title")}</h3>
                <TabSwitcher tabs={tabs} activeTab={range} onTabChange={onRangeChange} />
            </div>

            <div className="health-chart-grid">
                {charts.map((chart) => (
                    <div key={chart.key} className="health-card health-chart-card">
                        <h4>{t(`health.charts.${chart.key}`)}</h4>
                        <div className="health-chart-canvas">
                            {!points || (range === "live" && points.length < 2) ? (
                                <div className="health-chart-loading" />
                            ) : points.length < 2 ? (
                                <div className="health-chart-empty">
                                    <Icon path={mdiChartTimelineVariantShimmer} size={1.2} />
                                    {t("health.charts.noData")}
                                </div>
                            ) : (
                                <HealthChart
                                    points={points}
                                    range={range}
                                    series={chart.series}
                                    thresholds={chart.thresholds}
                                    format={chart.format}
                                    max={chart.max}
                                    stepped={chart.stepped}
                                    theme={theme}
                                />
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
};
