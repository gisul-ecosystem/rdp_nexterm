import Icon from "@mdi/react";
import { mdiChartBellCurveCumulative, mdiEthernet, mdiMonitorMultiple } from "@mdi/js";
import { useTranslation } from "react-i18next";
import { formatBytes, formatMbps, formatPct, levelFor } from "@/common/utils/healthFormat.js";
import "./styles.sass";

const RESOURCES = ["cpu", "memory", "bandwidth"];
const COST_FORMAT = { cpu: formatPct, memory: (v) => formatBytes(v), bandwidth: formatMbps };
const COST_KEY = { cpu: "perSessionCpu", memory: "perSessionMemory", bandwidth: "perSessionNetwork" };

const LinkNote = ({ canManage, onOpenSettings }) => {
    const { t } = useTranslation();
    return (
        <div className="health-capacity-note">
            <Icon path={mdiEthernet} size={0.7} />
            {canManage
                ? <button type="button" onClick={onOpenSettings}>{t("health.capacity.setLink")}</button>
                : <span>{t("health.capacity.setLink")}</span>}
        </div>
    );
};

export const CapacityCard = ({ live, canManage, onOpenSettings }) => {
    const { t } = useTranslation();
    const { capacity, rules, host } = live;
    const hasEstimate = capacity && capacity.confidence !== "none" && capacity.maxSessions !== null;
    const showLinkNote = !host.linkMbps;

    if (!hasEstimate) {
        return (
            <section className="health-card health-capacity">
                <div className="health-card-header">
                    <h3 className="health-card-title"><Icon path={mdiMonitorMultiple} size={0.8} />{t("health.capacity.title")}</h3>
                </div>
                <div className="health-empty">
                    <Icon path={mdiChartBellCurveCumulative} size={1.6} />
                    <strong>{t("health.capacity.noData")}</strong>
                    <span>{t("health.capacity.noDataHint")}</span>
                </div>
                {showLinkNote && <LinkNote canManage={canManage} onOpenSettings={onOpenSettings} />}
            </section>
        );
    }

    const { maxSessions, headroom, currentSessions, bottleneck, perResource, confidence } = capacity;
    const level = levelFor(headroom, rules.capacity, true);
    const usedPct = maxSessions ? Math.min(100, (currentSessions / maxSessions) * 100) : 100;
    const resources = RESOURCES.filter((key) => perResource[key]);
    const widest = Math.max(...resources.map((key) => perResource[key].maxSessions), 1);

    return (
        <section className={`health-card health-capacity health-level-${level}`}>
            <div className="health-card-header">
                <h3 className="health-card-title"><Icon path={mdiMonitorMultiple} size={0.8} />{t("health.capacity.title")}</h3>
                <span
                    className={`health-capacity-confidence health-capacity-confidence--${confidence}`}
                    title={t("health.capacity.confidenceHint", { points: capacity.busyPoints, max: capacity.maxObserved })}
                >
                    {t(`health.capacity.confidence.${confidence}`)}
                </span>
            </div>

            <div className="health-capacity-headline">
                <span className="health-capacity-big">
                    {headroom > 0 ? t("health.capacity.roomFor", { count: headroom }) : t("health.capacity.full")}
                </span>
                <span className="health-capacity-sub">{t("health.capacity.ofMax", { current: currentSessions, max: maxSessions })}</span>
            </div>

            <div className="health-capacity-bar" role="progressbar" aria-valuenow={currentSessions} aria-valuemin={0} aria-valuemax={maxSessions}>
                <div style={{ width: `${usedPct}%` }} />
            </div>

            <div className="health-capacity-resources">
                <span className="health-capacity-limited">
                    {t("health.capacity.limitedBy", { resource: t(`health.capacity.resources.${bottleneck}`) })}
                </span>
                {resources.map((key) => (
                    <div key={key} className={`health-capacity-resource${key === bottleneck ? " is-bottleneck" : ""}`}>
                        <span className="health-capacity-resource-name">{t(`health.capacity.resources.${key}`)}</span>
                        <div className="health-capacity-resource-track">
                            <div style={{ width: `${Math.max(4, (perResource[key].maxSessions / widest) * 100)}%` }} />
                        </div>
                        <span className="health-capacity-resource-value">~{perResource[key].maxSessions}</span>
                    </div>
                ))}
            </div>

            <div className="health-capacity-costs">
                <span>{t("health.capacity.perSession")}</span>
                <div>
                    {resources.map((key) => (
                        <span key={key} className="health-capacity-cost">
                            {t(`health.capacity.${COST_KEY[key]}`, { value: COST_FORMAT[key](perResource[key].perSession) })}
                        </span>
                    ))}
                </div>
            </div>

            {showLinkNote && <LinkNote canManage={canManage} onOpenSettings={onOpenSettings} />}
        </section>
    );
};
