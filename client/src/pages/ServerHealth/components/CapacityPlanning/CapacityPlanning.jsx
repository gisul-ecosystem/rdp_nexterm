import { useMemo } from "react";
import Icon from "@mdi/react";
import { mdiCalendarClock, mdiChartBar, mdiTrendingUp } from "@mdi/js";
import { Bar } from "react-chartjs-2";
import { useTranslation } from "react-i18next";
import { formatPct } from "@/common/utils/healthFormat.js";
import { useChartTheme, withAlpha } from "../../chartTheme.js";
import "./styles.sass";

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const HOUR_LABELS = [0, 3, 6, 9, 12, 15, 18, 21];

const DailyPeaks = ({ daily, theme }) => {
    const { t } = useTranslation();

    const data = useMemo(() => ({
        labels: daily.map((d) => new Date(`${d.day}T00:00:00Z`).toLocaleDateString([], { month: "short", day: "numeric", timeZone: "UTC" })),
        datasets: [
            {
                type: "line", label: t("health.planning.peakCpu"), data: daily.map((d) => d.peakCpu), yAxisID: "cpu",
                borderColor: theme.warning, backgroundColor: theme.warning, borderWidth: 2, pointRadius: 2, tension: 0.3, order: 0,
            },
            {
                type: "bar", label: t("health.planning.peakSessions"), data: daily.map((d) => d.peakSessions), yAxisID: "count",
                backgroundColor: withAlpha(theme.primary, 0.75), borderRadius: 4, maxBarThickness: 18, order: 1,
            },
            {
                type: "bar", label: t("health.planning.peakUsers"), data: daily.map((d) => d.peakUsers), yAxisID: "count",
                backgroundColor: withAlpha(theme.cyan, 0.6), borderRadius: 4, maxBarThickness: 18, order: 1,
            },
        ],
    }), [daily, theme, t]);

    const options = useMemo(() => ({
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
            legend: { position: "bottom", labels: { color: theme.text, usePointStyle: true, boxWidth: 10, padding: 12, font: { size: 11 } } },
            tooltip: {
                backgroundColor: theme.background, titleColor: theme.foreground, bodyColor: theme.foreground,
                borderColor: theme.grid, borderWidth: 1, padding: 10, boxPadding: 4,
                callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${ctx.dataset.yAxisID === "cpu" ? formatPct(ctx.parsed.y) : ctx.parsed.y}` },
            },
        },
        scales: {
            x: { grid: { display: false }, border: { display: false }, ticks: { color: theme.text, maxRotation: 0, autoSkip: true, maxTicksLimit: 10, font: { size: 11 } } },
            count: {
                position: "left", beginAtZero: true, grid: { color: theme.grid }, border: { display: false },
                ticks: { color: theme.text, precision: 0, font: { size: 11 } },
            },
            cpu: {
                position: "right", beginAtZero: true, max: 100, grid: { display: false }, border: { display: false },
                ticks: { color: theme.text, maxTicksLimit: 5, font: { size: 11 }, callback: (v) => `${v}%` },
            },
        },
    }), [theme]);

    return <Bar data={data} options={options} />;
};

const Heatmap = ({ heatmap, days }) => {
    const { t } = useTranslation();
    const dayNames = useMemo(() => WEEK_ORDER.map((d) => new Date(Date.UTC(2024, 0, 7 + d)).toLocaleDateString([], { weekday: "short", timeZone: "UTC" })), []);
    const peak = Math.max(0, ...heatmap.flat().map((c) => c.avg ?? 0));

    return (
        <div className="health-heatmap">
            <div className="health-heatmap-grid">
                <span />
                {Array.from({ length: 24 }, (_, hour) => (
                    <span key={hour} className="health-heatmap-hour">{HOUR_LABELS.includes(hour) ? String(hour).padStart(2, "0") : ""}</span>
                ))}
                {WEEK_ORDER.map((day, row) => [
                    <span key={`d${day}`} className="health-heatmap-day">{dayNames[row]}</span>,
                    ...heatmap[day].map((cell, hour) => (
                        <span
                            key={`${day}-${hour}`}
                            className={`health-heatmap-cell${cell.avg === null ? " is-empty" : ""}`}
                            style={cell.avg === null ? undefined : { "--intensity": peak ? 0.08 + 0.92 * (cell.avg / peak) : 0.08 }}
                            title={cell.avg === null ? undefined : t("health.planning.heatmapCell", {
                                day: dayNames[row], hour: String(hour).padStart(2, "0"), avg: cell.avg, peak: cell.peak,
                            })}
                        />
                    )),
                ])}
            </div>
            <div className="health-heatmap-legend">
                <span>{t("health.planning.less")}</span>
                {[0.08, 0.3, 0.55, 0.8, 1].map((v) => <span key={v} className="health-heatmap-cell" style={{ "--intensity": v }} />)}
                <span>{t("health.planning.more")}</span>
            </div>
            <p className="health-card-hint">{t("health.planning.heatmapHint", { days })}</p>
        </div>
    );
};

export const CapacityPlanning = ({ planning }) => {
    const { t } = useTranslation();
    const theme = useChartTheme();
    const daily = planning?.daily || [];

    return (
        <section className="health-planning">
            <div className="health-section-header">
                <h3 className="health-section-title"><Icon path={mdiTrendingUp} size={0.85} />{t("health.planning.title")}</h3>
            </div>
            <div className="health-planning-grid">
                <div className="health-card">
                    <div className="health-card-header">
                        <h3 className="health-card-title"><Icon path={mdiChartBar} size={0.8} />{t("health.planning.dailyPeaks")}</h3>
                    </div>
                    <div className="health-planning-chart">
                        {daily.length ? <DailyPeaks daily={daily} theme={theme} /> : (
                            <div className="health-empty">
                                <Icon path={mdiChartBar} size={1.6} />
                                <span>{t("health.planning.noDaily")}</span>
                            </div>
                        )}
                    </div>
                </div>
                <div className="health-card">
                    <div className="health-card-header">
                        <h3 className="health-card-title"><Icon path={mdiCalendarClock} size={0.8} />{t("health.planning.heatmap")}</h3>
                    </div>
                    {planning?.heatmap
                        ? <Heatmap heatmap={planning.heatmap} days={planning.heatmapDays} />
                        : <div className="health-planning-chart" />}
                </div>
            </div>
        </section>
    );
};
