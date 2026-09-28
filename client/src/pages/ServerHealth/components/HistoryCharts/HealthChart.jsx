import { useMemo } from "react";
import { Line } from "react-chartjs-2";
import { withAlpha } from "../../chartTheme.js";

const LONG_RANGES = new Set(["7d", "30d"]);

const labelFor = (iso, range) => {
    const date = new Date(iso);
    if (range === "30d") return date.toLocaleDateString([], { month: "short", day: "numeric" });
    if (LONG_RANGES.has(range)) return date.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

/**
 * series: [{ label, color, value(point), fill?, dashed? }]
 * thresholds: [{ label, value, color }] drawn as flat dashed lines
 */
export const HealthChart = ({ points, range, series, thresholds = [], format, max, stepped, theme }) => {
    const data = useMemo(() => ({
        labels: points.map((p) => labelFor(p.t, range)),
        datasets: [
            ...series.map((s) => ({
                label: s.label,
                data: points.map((p) => s.value(p)),
                borderColor: s.color,
                backgroundColor: s.fill ? withAlpha(s.color, 0.18) : s.color,
                fill: s.fill ? "origin" : false,
                borderWidth: s.fill ? 2 : 1.5,
                borderDash: s.dashed ? [4, 4] : undefined,
                pointRadius: 0,
                pointHoverRadius: 3,
                tension: stepped ? 0 : 0.3,
                stepped: stepped ? "middle" : false,
                spanGaps: true,
            })),
            ...thresholds.map((th) => ({
                label: th.label,
                data: points.map(() => th.value),
                borderColor: withAlpha(th.color, 0.7),
                borderDash: [6, 4],
                borderWidth: 1,
                pointRadius: 0,
                pointHoverRadius: 0,
                fill: false,
                isThreshold: true,
            })),
        ],
    }), [points, range, series, thresholds, stepped]);

    const options = useMemo(() => ({
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        interaction: { mode: "index", intersect: false },
        plugins: {
            legend: {
                position: "bottom",
                labels: {
                    color: theme.text,
                    usePointStyle: true,
                    pointStyle: "line",
                    boxWidth: 18,
                    padding: 12,
                    font: { size: 11 },
                },
            },
            tooltip: {
                backgroundColor: theme.background,
                titleColor: theme.foreground,
                bodyColor: theme.foreground,
                borderColor: theme.grid,
                borderWidth: 1,
                padding: 10,
                boxPadding: 4,
                filter: (item) => !item.dataset.isThreshold,
                callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${format(ctx.parsed.y)}` },
            },
        },
        scales: {
            x: {
                grid: { display: false },
                border: { display: false },
                ticks: { color: theme.text, maxTicksLimit: 7, maxRotation: 0, autoSkip: true, font: { size: 11 } },
            },
            y: {
                beginAtZero: true,
                suggestedMax: max,
                max: max === 100 ? 100 : undefined,
                grid: { color: theme.grid },
                border: { display: false },
                ticks: { color: theme.text, maxTicksLimit: 5, font: { size: 11 }, callback: (v) => format(v) },
            },
        },
    }), [theme, format, max]);

    return <Line data={data} options={options} />;
};
