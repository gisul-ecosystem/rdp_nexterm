import { useEffect } from "react";

// Runs `load` now and every `intervalMs`, pausing while the browser tab is hidden. `load` must be memoized.
export const usePolling = (load, intervalMs) => {
    useEffect(() => {
        let timer = null;
        const start = () => {
            if (timer) return;
            load();
            timer = setInterval(load, intervalMs);
        };
        const stop = () => {
            clearInterval(timer);
            timer = null;
        };
        const onVisibility = () => (document.hidden ? stop() : start());

        if (!document.hidden) start();
        document.addEventListener("visibilitychange", onVisibility);
        return () => {
            stop();
            document.removeEventListener("visibilitychange", onVisibility);
        };
    }, [load, intervalMs]);
};
