import { memo } from "react";
import Icon from "@mdi/react";
import { mdiLaptop, mdiServer, mdiClose, mdiAlertCircle, mdiInformation } from "@mdi/js";
import { useTranslation } from "react-i18next";
import "./styles.sass";

// Close reasons sent by the server when it ends a session on purpose.
const SESSION_END_REASONS = {
    "opened in another tab": "replaced",
    "taken over by another user": "takenOver",
    "disconnected by an administrator": "admin",
};

export const mapConnectionError = (rawMessage, t) => {
    if (!rawMessage) return t("common.errors.connection.failed");

    const cleaned = rawMessage.replace(/^error:\s*/i, "").trim();
    const msg = cleaned.toLowerCase();

    const ended = SESSION_END_REASONS[msg];
    if (ended) {
        return {
            ended: true,
            title: t(`common.errors.connection.ended.${ended}Title`),
            message: t(`common.errors.connection.ended.${ended}Message`),
        };
    }

    if (msg.includes("connection not available") || msg.includes("not available")) {
        return t("common.errors.connection.hostUnreachable");
    }
    if (msg.includes("no route to host") || msg.includes("unreachable")) {
        return t("common.errors.connection.hostUnreachable");
    }
    if (msg.includes("connection refused") || msg.includes("refused")) {
        return t("common.errors.connection.refused");
    }
    if (msg.includes("timeout") || msg.includes("timed out")) {
        return t("common.errors.connection.timeout");
    }
    if (msg.includes("authentication") || msg.includes("auth")) {
        return t("common.errors.connection.authenticationFailed");
    }
    if (msg.includes("permission denied")) {
        return t("common.errors.connection.permissionDenied");
    }
    if (msg.includes("aborted") || msg.includes("see logs")) {
        return t("common.errors.connection.hostUnreachable");
    }

    return cleaned.replace(/\(see logs\)/gi, "").trim() || t("common.errors.connection.failed");
};

export const ConnectionError = memo(({ message, onClose }) => {
    const { t } = useTranslation();
    const error = typeof message === "string" ? { message } : message;

    return (
        <div className={`connection-error${error.ended ? " connection-error--ended" : ""}`}>
            <div className="connection-error__bar" />
            <div className="connection-error__visual">
                <div className="connection-error__device">
                    <Icon path={mdiLaptop} className="connection-error__device-icon" />
                </div>
                <div className="connection-error__link">
                    <span className="connection-error__link-line" />
                    <span className="connection-error__link-badge">
                        <Icon path={error.ended ? mdiInformation : mdiAlertCircle} />
                    </span>
                    <span className="connection-error__link-line" />
                </div>
                <div className="connection-error__device connection-error__device--server">
                    <Icon path={mdiServer} className="connection-error__device-icon" />
                </div>
            </div>
            <div className="connection-error__text">
                <h2 className="connection-error__title">{error.title || t("common.errors.connection.title")}</h2>
                <p className="connection-error__message">{error.message}</p>
            </div>
            {onClose && (
                <button type="button" className="connection-error__action" onClick={onClose}>
                    <Icon path={mdiClose} />
                    <span>{t("common.errors.connection.close")}</span>
                </button>
            )}
        </div>
    );
});