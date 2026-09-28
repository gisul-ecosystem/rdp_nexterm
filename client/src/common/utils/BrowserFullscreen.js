// Real browser full screen plus Keyboard Lock (Chrome/Edge), so Windows, Alt+Tab, Alt+F4 and Esc reach the
// remote session. The browser only honours the lock while in full screen; holding Esc always exits.
// Both calls must happen inside a user gesture (click or key press).

export const isBrowserFullscreen = () => !!document.fullscreenElement;

export const enterBrowserFullscreen = async () => {
    const root = document.documentElement;
    if (!document.fullscreenElement) {
        if (!root.requestFullscreen) return false;
        try {
            await root.requestFullscreen({ navigationUI: "hide" });
        } catch {
            return false;
        }
    }
    try {
        await navigator.keyboard?.lock?.();
    } catch {
        // Keyboard Lock is optional (Firefox/Safari): full screen still works without it.
    }
    return true;
};

export const exitBrowserFullscreen = async () => {
    try {
        navigator.keyboard?.unlock?.();
    } catch {
        // Nothing was locked.
    }
    if (!document.fullscreenElement) return;
    try {
        await document.exitFullscreen();
    } catch {
        // Already left full screen.
    }
};

export const toggleBrowserFullscreen = () => (isBrowserFullscreen() ? exitBrowserFullscreen() : enterBrowserFullscreen());

// Calls `onChange(active)` when full screen starts or ends, including hold-Esc and F11 exits.
export const onBrowserFullscreenChange = (onChange) => {
    const handler = () => {
        const active = isBrowserFullscreen();
        if (!active) navigator.keyboard?.unlock?.();
        onChange(active);
    };
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
};
