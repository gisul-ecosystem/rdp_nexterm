import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Icon from "@mdi/react";
import { mdiAlertOctagonOutline, mdiAlertOutline, mdiClose } from "@mdi/js";
import { useTranslation } from "react-i18next";
import { useHealthAlerts } from "@/common/hooks/useHealthAlerts.js";
import { formatRuleValue } from "@/common/utils/healthFormat.js";
import "./styles.sass";

const DISMISSED_KEY = "healthAlertsDismissed";

const alertKey = (alert) => `${alert.id}:${alert.severity}`;

const readDismissed = () => {
    try { return new Set(JSON.parse(sessionStorage.getItem(DISMISSED_KEY) || "[]")); } catch { return new Set(); }
};

// Unacknowledged server health alerts on every page; dismissing hides an alert until it escalates.
export const HealthAlertBanner = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const location = useLocation();
    const alerts = useHealthAlerts();
    const [dismissed, setDismissed] = useState(readDismissed);

    const visible = alerts
        .filter((a) => !a.acknowledgedAt && !dismissed.has(alertKey(a)))
        .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1));

    if (!visible.length || location.pathname.startsWith("/health")) return null;

    const dismiss = () => {
        const next = new Set([...dismissed, ...visible.map(alertKey)]);
        sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...next]));
        setDismissed(next);
    };

    const [first] = visible;
    const critical = first.severity === "critical";

    return (
        <div className={`health-alert-banner health-alert-banner--${first.severity}`} role="alert">
            <Icon path={critical ? mdiAlertOctagonOutline : mdiAlertOutline} className="health-alert-banner__icon" />
            <div className="health-alert-banner__content">
                <span className="health-alert-banner__title">{t("common.sidebar.health")}</span>
                <span className="health-alert-banner__text">
                    {t("health.alerts.banner", { rule: t(`health.rules.${first.rule}`), value: formatRuleValue(first.rule, first.value) })}
                    {visible.length > 1 && ` ${t("health.alerts.bannerMore", { count: visible.length - 1 })}`}
                </span>
            </div>
            <button className="health-alert-banner__action" onClick={() => navigate("/health")}>{t("health.alerts.view")}</button>
            <button className="health-alert-banner__close" onClick={dismiss} aria-label={t("health.alerts.dismiss")}>
                <Icon path={mdiClose} />
            </button>
        </div>
    );
};
