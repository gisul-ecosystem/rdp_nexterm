import { useCallback, useEffect, useRef, useState } from "react";
import useWebSocket, { ReadyState } from "react-use-websocket";
import { getWebSocketUrl, getTabId, getBrowserId } from "@/common/utils/ConnectionUtil.js";
import { closeAllPopouts } from "@/common/utils/PopoutUtil.js";

export const STATE_TYPES = { ENTRIES: "ENTRIES", IDENTITIES: "IDENTITIES", SNIPPETS: "SNIPPETS", CONNECTIONS: "CONNECTIONS", LIVE_SESSIONS: "LIVE_SESSIONS", SESSION_PRESENCE: "SESSION_PRESENCE", ACCESS_REQUEST: "ACCESS_REQUEST", HEALTH_ALERTS: "HEALTH_ALERTS", HEALTH_LIVE: "HEALTH_LIVE", LOGOUT: "LOGOUT" };

export const forceLogoutClient = async () => {
    await closeAllPopouts();
    localStorage.removeItem("sessionToken");
    localStorage.removeItem("overrideToken");
    window.location.reload();
};

export const useStateStream = (sessionToken, handlers = {}) => {
    const handlersRef = useRef(handlers);
    const [connectionError, setConnectionError] = useState(false);
    const hasConnectedRef = useRef(false);
    const invalidatedRef = useRef(false);
    const socketRef = useRef(null);
    const subscriptionsRef = useRef(new Map());
    
    useEffect(() => { handlersRef.current = handlers; }, [handlers]);

    const wsUrl = sessionToken ? getWebSocketUrl("/api/ws/state", { sessionToken, tabId: getTabId(), browserId: getBrowserId() }) : null;

    const sendRaw = useCallback((payload) => {
        const socket = socketRef.current;
        if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
    }, []);
    
    const onOpen = useCallback((e) => {
        hasConnectedRef.current = true;
        socketRef.current = e.target;
        setConnectionError(false);
        for (const type of subscriptionsRef.current.keys()) sendRaw({ action: "subscribe", type });
    }, [sendRaw]);
    
    const onClose = useCallback((e) => {
        socketRef.current = null;
        if (e.code === 4010 && hasConnectedRef.current) {
            invalidatedRef.current = true;
            forceLogoutClient();
            return;
        }
        if (!hasConnectedRef.current) setConnectionError(true);
    }, []);
    
    const onError = useCallback(() => {
        if (!hasConnectedRef.current) setConnectionError(true);
    }, []);

    const onMessage = useCallback((e) => {
        try {
            const { type, data } = JSON.parse(e.data);
            if (type && handlersRef.current[type]) handlersRef.current[type](data);
        } catch {}
    }, []);

    const { sendMessage, readyState } = useWebSocket(wsUrl, {
        shouldReconnect: (e) => !invalidatedRef.current && e.code !== 4010,
        reconnectAttempts: Infinity,
        reconnectInterval: 3000,
        retryOnError: true,
        onOpen,
        onClose,
        onError,
        onMessage,
        filter: () => false,
    }, !!sessionToken);

    useEffect(() => {
        if (!sessionToken || hasConnectedRef.current || readyState !== ReadyState.CONNECTING) return;
        const timeout = setTimeout(() => { if (!hasConnectedRef.current) setConnectionError(true); }, 5000);
        return () => clearTimeout(timeout);
    }, [sessionToken, readyState]);

    useEffect(() => {
        if (!sessionToken) {
            hasConnectedRef.current = false;
            invalidatedRef.current = false;
            setConnectionError(false);
        }
    }, [sessionToken]);

    const requestRefresh = useCallback((type = null) => {
        if (readyState === ReadyState.OPEN) sendMessage(JSON.stringify({ action: "refresh", type }));
    }, [sendMessage, readyState]);

    const subscribe = useCallback((type) => {
        const subscriptions = subscriptionsRef.current;
        const count = subscriptions.get(type) || 0;
        subscriptions.set(type, count + 1);
        if (!count) sendRaw({ action: "subscribe", type });
        let active = true;
        return () => {
            if (!active) return;
            active = false;
            const remaining = (subscriptions.get(type) || 1) - 1;
            if (remaining) {
                subscriptions.set(type, remaining);
            } else {
                subscriptions.delete(type);
                sendRaw({ action: "unsubscribe", type });
            }
        };
    }, [sendRaw]);

    return { isConnected: readyState === ReadyState.OPEN, connectionError, requestRefresh, subscribe };
};
