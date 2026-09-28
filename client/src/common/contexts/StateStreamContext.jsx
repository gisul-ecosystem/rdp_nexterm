import { createContext, useContext, useCallback, useMemo, useRef, useEffect } from "react";
import { UserContext } from "@/common/contexts/UserContext.jsx";
import { useStateStream, STATE_TYPES, forceLogoutClient } from "@/common/hooks/useStateStream.js";

export const StateStreamContext = createContext({});
export { STATE_TYPES };

const stateTypes = Object.values(STATE_TYPES).filter(t => t !== "LOGOUT");
const unbufferedTypes = new Set([STATE_TYPES.HEALTH_LIVE, STATE_TYPES.ACCESS_REQUEST]);

export const StateStreamProvider = ({ children }) => {
    const { sessionToken } = useContext(UserContext);
    const handlersRef = useRef(Object.fromEntries(stateTypes.map(t => [t, new Set()])));
    const stateBufferRef = useRef(Object.fromEntries(stateTypes.map(t => [t, null])));

    const stateHandlers = useMemo(() => ({
        ...Object.fromEntries(stateTypes.map(t => [t, (data) => {
            if (!unbufferedTypes.has(t)) stateBufferRef.current[t] = data;
            handlersRef.current[t].forEach(h => h(data));
        }])),
        [STATE_TYPES.LOGOUT]: forceLogoutClient
    }), []);

    const { isConnected, connectionError, requestRefresh, subscribe } = useStateStream(sessionToken, stateHandlers);

    useEffect(() => {
        if (!sessionToken) stateBufferRef.current = Object.fromEntries(stateTypes.map(t => [t, null]));
    }, [sessionToken]);

    const registerHandler = useCallback((stateType, handler) => {
        if (!handlersRef.current[stateType]) return () => {};
        handlersRef.current[stateType].add(handler);
        if (stateBufferRef.current[stateType] !== null) handler(stateBufferRef.current[stateType]);
        return () => handlersRef.current[stateType].delete(handler);
    }, []);

    const contextValue = useMemo(() => ({ 
        isConnected, 
        connectionError, 
        registerHandler, 
        requestRefresh,
        subscribe,
    }), [isConnected, connectionError, registerHandler, requestRefresh, subscribe]);
    
    return <StateStreamContext.Provider value={contextValue}>{children}</StateStreamContext.Provider>;
};
