// Real browser full screen plus Keyboard Lock (Chrome/Edge), so Windows, Alt+Tab, Alt+F4 and browser shortcuts reach
// the remote session. Esc is deliberately left unlocked so a single press leaves full screen.
// The browser only honours the lock while in full screen. Both calls must happen inside a user gesture.

const LOCKED_KEYS = [
    ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((c) => `Key${c}`),
    ..."0123456789".split("").map((d) => `Digit${d}`),
    ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
    ..."0123456789".split("").map((d) => `Numpad${d}`),
    "NumpadAdd", "NumpadSubtract", "NumpadMultiply", "NumpadDivide", "NumpadDecimal", "NumpadEnter", "NumLock",
    "MetaLeft", "MetaRight", "AltLeft", "AltRight", "ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight",
    "Tab", "Space", "Enter", "Backspace", "Delete", "Insert", "Home", "End", "PageUp", "PageDown",
    "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "CapsLock", "ScrollLock", "Pause", "PrintScreen", "ContextMenu",
    "Backquote", "Minus", "Equal", "BracketLeft", "BracketRight", "Backslash", "Semicolon", "Quote", "Comma", "Period",
    "Slash", "IntlBackslash",
];

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
        await navigator.keyboard?.lock?.(LOCKED_KEYS);
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
