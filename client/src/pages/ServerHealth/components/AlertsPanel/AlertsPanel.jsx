import { useState } from "react";
import Icon from "@mdi/react";
import { mdiAlertCircleOutline, mdiAlertOctagonOutline, mdiBellOutline, mdiCheck, mdiCheckCircleOutline, mdiHistory, mdiShieldCheckOutline } from "@mdi/js";
import { useTranslation } from "react-i18next";
import TabSwitcher from "@/common/components/TabSwitcher";
import Button from "@/common/components/Button";
import { formatClock, formatRuleValue, formatUptime } from "@/common/utils/healthFormat.js";
import "./styles.sass";

const SEVERITY_ICON = { warning: mdiAlertCircleOutline, critical: mdiAlertOctagonOutline };
const secondsBetween = (from, to) => Math.max(0, (new Date(to) - new Date(from)) / 1000);

const ActiveAlert = ({ alert, onAcknowledge }) => {
    const { t } = useTranslation();
    return (
        <li className={`health-alert health-alert--${alert.severity}${alert.acknowledgedAt ? " is-acknowledged" : ""}`}>
            <Icon path={SEVERITY_ICON[alert.severity]} size={0.9} className="health-alert-icon" />
            <div className="health-alert-body">
                <div className="health-alert-title">
                    <strong>{t(`health.rules.${alert.rule}`)}</strong>
                    <span className="health-alert-severity">{t(`health.alerts.severity.${alert.severity}`)}</span>
                </div>
                <span className="health-alert-detail">
                    {t("health.alerts.value", { value: formatRuleValue(alert.rule, alert.value), threshold: formatRuleValue(alert.rule, alert.threshold) })}
                    {" · "}{t("health.alerts.since", { time: formatClock(alert.startedAt) })}
                </span>
                {alert.acknowledgedAt && (
                    <span className="health-alert-ack">
                        <Icon path={mdiCheck} size={0.55} />
                        {t("health.alerts.acknowledged", { user: alert.acknowledgedByName || "–" })}
                    </span>
                )}
            </div>
            {!alert.acknowledgedAt && (
                <Button type="secondary" icon={mdiCheck} text={t("health.alerts.acknowledge")} onClick={() => onAcknowledge(alert.id)} />
            )}
        </li>
    );
};

const HistoryAlert = ({ alert }) => {
    const { t } = useTranslation();
    const resolved = alert.status === "resolved";
    return (
        <li className={`health-alert-row health-alert-row--${alert.severity}`}>
            <span className="health-alert-dot" />
            <div className="health-alert-row-main">
                <strong>{t(`health.rules.${alert.rule}`)}</strong>
                <span>{formatClock(alert.startedAt)}</span>
            </div>
            <div className="health-alert-row-meta">
                <span>{t("health.alerts.peak", { value: formatRuleValue(alert.rule, alert.peakValue ?? alert.value) })}</span>
                <span className={`health-alert-status${resolved ? " is-resolved" : ""}`}>
                    {resolved
                        ? `${t("health.alerts.resolved")} · ${t("health.alerts.lasted", { duration: formatUptime(secondsBetween(alert.startedAt, alert.resolvedAt)) })}`
                        : t(`health.alerts.severity.${alert.severity}`)}
                </span>
            </div>
        </li>
    );
};

export const AlertsPanel = ({ active, history, onAcknowledge, onShowMore }) => {
    const { t } = useTranslation();
    const [tab, setTab] = useState("active");

    const tabs = [
        { key: "active", label: t("health.alerts.active"), icon: mdiBellOutline },
        { key: "history", label: t("health.alerts.history"), icon: mdiHistory },
    ];

    return (
        <section className="health-card health-alerts">
            <div className="health-card-header">
                <h3 className="health-card-title">
                    <Icon path={mdiBellOutline} size={0.8} />
                    {t("health.alerts.title")}
                    {active.length > 0 && <span className="health-alerts-count">{active.length}</span>}
                </h3>
                <TabSwitcher tabs={tabs} activeTab={tab} onTabChange={setTab} />
            </div>

            {tab === "active" && (active.length ? (
                <ul className="health-alert-list">
                    {active.map((alert) => <ActiveAlert key={alert.id} alert={alert} onAcknowledge={onAcknowledge} />)}
                </ul>
            ) : (
                <div className="health-empty">
                    <Icon path={mdiShieldCheckOutline} size={1.6} />
                    <strong>{t("health.alerts.none")}</strong>
                    <span>{t("health.status.okHint")}</span>
                </div>
            ))}

            {tab === "history" && (history.alerts.length ? (
                <>
                    <ul className="health-alert-history">
                        {history.alerts.map((alert) => <HistoryAlert key={alert.id} alert={alert} />)}
                    </ul>
                    {history.alerts.length < history.total && (
                        <div className="health-alerts-more">
                            <Button type="secondary" text={t("health.alerts.showMore")} onClick={onShowMore} />
                        </div>
                    )}
                </>
            ) : (
                <div className="health-empty">
                    <Icon path={mdiCheckCircleOutline} size={1.6} />
                    <strong>{t("health.alerts.noHistory")}</strong>
                </div>
            ))}
        </section>
    );
};
