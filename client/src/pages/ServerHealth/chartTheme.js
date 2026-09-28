import {
    Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, BarController, LineController,
    Tooltip, Legend, Filler,
} from "chart.js";
import { useEffect, useState } from "react";
import { usePreferences } from "@/common/contexts/PreferencesContext.jsx";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, BarController, LineController, Tooltip, Legend, Filler);

const cssVar = (name, fallback) => {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
};

const readTheme = () => ({
    text: cssVar("--subtext", "#B7B7B7"),
    grid: cssVar("--gray", "rgba(255, 255, 255, 0.1)"),
    background: cssVar("--lighter-background", "#0D161E"),
    foreground: cssVar("--text", "#FFFFFF"),
    primary: cssVar("--primary", "#314BD3"),
    success: cssVar("--success", "#29C16A"),
    warning: cssVar("--warning", "#DC5600"),
    error: cssVar("--error", "#a44747"),
    violet: "#9B6BFF",
    cyan: "#22B8CF",
    amber: "#F2B01E",
});

// Canvas cannot use CSS variables, so resolve them for the active theme. The provider applies the
// theme attribute in its own effect, which runs after ours, hence the extra frame.
export const useChartTheme = () => {
    const { theme, accentColor } = usePreferences();
    const [colors, setColors] = useState(readTheme);

    useEffect(() => {
        const frame = requestAnimationFrame(() => setColors(readTheme()));
        return () => cancelAnimationFrame(frame);
    }, [theme, accentColor]);

    return colors;
};

export const withAlpha = (color, alpha) => {
    const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
        const digits = hex[1].length === 3 ? hex[1].split("").map((d) => d + d).join("") : hex[1];
        const [r, g, b] = [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16));
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    const rgb = color.match(/^rgba?\(([^,]+),([^,]+),([^,)]+)/i);
    return rgb ? `rgba(${rgb[1].trim()}, ${rgb[2].trim()}, ${rgb[3].trim()}, ${alpha})` : color;
};
