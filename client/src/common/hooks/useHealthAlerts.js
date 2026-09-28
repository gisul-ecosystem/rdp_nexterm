import { useContext, useEffect, useState } from "react";
import { StateStreamContext, STATE_TYPES } from "@/common/contexts/StateStreamContext.jsx";
import { UserContext } from "@/common/contexts/UserContext.jsx";
import { Permission } from "@/common/utils/permissions.js";

// Active server health alerts, pushed over the state stream to users who may view server health.
export const useHealthAlerts = () => {
    const { registerHandler } = useContext(StateStreamContext);
    const { hasPermission } = useContext(UserContext);
    const allowed = !!hasPermission?.(Permission.SERVER_HEALTH_VIEW);
    const [alerts, setAlerts] = useState([]);

    useEffect(() => {
        if (!allowed || !registerHandler) return undefined;
        return registerHandler(STATE_TYPES.HEALTH_ALERTS, (data) => setAlerts(Array.isArray(data) ? data : []));
    }, [allowed, registerHandler]);

    return allowed ? alerts : [];
};
