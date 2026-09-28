import { useContext, useEffect, useRef, useState } from "react";
import { StateStreamContext, STATE_TYPES } from "@/common/contexts/StateStreamContext.jsx";

const MAX_POINTS = 300;
const STALE_MS = 5000;

// Subscribes to the per-second health readings while `enabled` and the tab is visible.
export const useRealtimeHealth = (enabled) => {
    const { subscribe, registerHandler, isConnected } = useContext(StateStreamContext);
    const [points, setPoints] = useState([]);
    const [receiving, setReceiving] = useState(false);
    const lastAt = useRef(0);

    useEffect(() => {
        if (!enabled || !subscribe || !registerHandler) return undefined;
        let unsubscribe = null;

        const unregister = registerHandler(STATE_TYPES.HEALTH_LIVE, (data) => {
            lastAt.current = Date.now();
            setReceiving(true);
            if (Array.isArray(data?.points)) setPoints(data.points.slice(-MAX_POINTS));
            else if (data?.point) setPoints((current) => [...current, data.point].slice(-MAX_POINTS));
        });
        const start = () => {
            if (!unsubscribe) unsubscribe = subscribe(STATE_TYPES.HEALTH_LIVE);
        };
        const stop = () => {
            unsubscribe?.();
            unsubscribe = null;
            setReceiving(false);
        };
        const onVisibility = () => (document.hidden ? stop() : start());
        const watchdog = setInterval(() => {
            if (Date.now() - lastAt.current > STALE_MS) setReceiving(false);
        }, 1000);

        if (!document.hidden) start();
        document.addEventListener("visibilitychange", onVisibility);
        return () => {
            clearInterval(watchdog);
            document.removeEventListener("visibilitychange", onVisibility);
            unregister();
            stop();
        };
    }, [enabled, subscribe, registerHandler]);

    const connected = enabled && isConnected && receiving;
    return { points, latest: connected ? points.at(-1) || null : null, connected };
};
