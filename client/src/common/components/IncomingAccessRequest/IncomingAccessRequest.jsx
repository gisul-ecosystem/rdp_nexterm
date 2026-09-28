import { useContext, useEffect, useState } from "react";
import { StateStreamContext, STATE_TYPES } from "@/common/contexts/StateStreamContext.jsx";
import { useToast } from "@/common/contexts/ToastContext.jsx";
import { postRequest } from "@/common/utils/RequestUtil";
import { getBrowserId } from "@/common/utils/ConnectionUtil.js";
import { AccessApproveDialog } from "@/pages/Servers/components/AccessRequestDialog";

// Mounted in every app layout (main window and pop-outs) so the person using a VM is asked wherever they are.
export const IncomingAccessRequest = () => {
    const { registerHandler } = useContext(StateStreamContext);
    const { sendToast } = useToast();
    const [request, setRequest] = useState(null);

    useEffect(() => registerHandler(STATE_TYPES.ACCESS_REQUEST, (data) => {
        if (!data?.requestId || data.role !== "holder") return;
        if (data.status === "pending") setRequest(data);
        else setRequest((current) => current?.requestId === data.requestId ? null : current);
    }), [registerHandler]);

    const respond = async (decision) => {
        const requestId = request?.requestId;
        if (!requestId) return;
        try {
            await postRequest(`/connections/access-requests/${requestId}/respond`, { decision, browserId: getBrowserId() });
            setRequest(null);
            if (decision === "deny") sendToast("Request denied", "The other user was blocked from connecting");
            if (decision === "allow") sendToast("Request allowed", "You will be disconnected; they are taking over");
        } catch (error) {
            setRequest(null);
            sendToast("Error", error?.error || error?.message || "Could not respond to request");
        }
    };

    return (
        <AccessApproveDialog
            open={!!request}
            request={request}
            onAllow={() => respond("allow")}
            onDeny={() => respond("deny")}
        />
    );
};
