import Icon from "@mdi/react";
import { mdiAccountOffOutline, mdiArrowDown, mdiArrowRight, mdiArrowUp, mdiMonitorDashboard } from "@mdi/js";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { formatBytes, formatRate } from "@/common/utils/healthFormat.js";
import { formatDuration, machineName, userName } from "@/pages/Usage/usageFormat.js";
import "./styles.sass";

export const SessionsLoad = ({ sessions, now }) => {
    const { t } = useTranslation();
    const busiest = Math.max(1, ...sessions.map((s) => s.inRate + s.outRate));
    const nowMs = new Date(now).getTime();

    return (
        <section className="health-card health-sessions">
            <div className="health-card-header">
                <h3 className="health-card-title">
                    <Icon path={mdiMonitorDashboard} size={0.8} />
                    {t("health.sessions.title")}
                    {sessions.length > 0 && <span className="health-sessions-count">{sessions.length}</span>}
                </h3>
                <Link to="/usage" className="health-sessions-link">
                    {t("health.sessions.manage")}
                    <Icon path={mdiArrowRight} size={0.6} />
                </Link>
            </div>

            {sessions.length === 0 ? (
                <div className="health-empty">
                    <Icon path={mdiAccountOffOutline} size={1.6} />
                    <span>{t("health.sessions.empty")}</span>
                </div>
            ) : (
                <div className="health-sessions-table" role="table">
                    <div className="health-sessions-row health-sessions-head" role="row">
                        <span role="columnheader">{t("health.sessions.user")}</span>
                        <span role="columnheader">{t("health.sessions.machine")}</span>
                        <span role="columnheader">{t("health.sessions.state")}</span>
                        <span role="columnheader">{t("health.sessions.duration")}</span>
                        <span role="columnheader">{t("health.sessions.traffic")}</span>
                        <span role="columnheader">{t("health.sessions.total")}</span>
                    </div>
                    {sessions.map((s) => {
                        const rate = s.inRate + s.outRate;
                        return (
                            <div key={s.sessionId} className="health-sessions-row" role="row">
                                <span className="health-sessions-user" role="cell">{userName(s.user)}</span>
                                <span className="health-sessions-machine" role="cell">
                                    <span>{machineName(s, t)}</span>
                                    {s.protocol && <span className="health-sessions-protocol">{s.protocol}</span>}
                                </span>
                                <span role="cell">
                                    <span className={`health-sessions-state health-sessions-state--${s.state}`}>
                                        {t(`usage.live.states.${s.state}`, { defaultValue: s.state })}
                                    </span>
                                </span>
                                <span className="health-sessions-num" role="cell">
                                    {formatDuration((nowMs - new Date(s.startedAt).getTime()) / 1000)}
                                </span>
                                <span className="health-sessions-traffic" role="cell" title={`↓ ${formatRate(s.outRate)} · ↑ ${formatRate(s.inRate)}`}>
                                    <span className="health-sessions-bar"><span style={{ width: `${(rate / busiest) * 100}%` }} /></span>
                                    <span className="health-sessions-num">{formatRate(rate)}</span>
                                </span>
                                <span className="health-sessions-num health-sessions-total" role="cell">
                                    <span><Icon path={mdiArrowDown} size={0.5} />{formatBytes(s.bytesOut)}</span>
                                    <span><Icon path={mdiArrowUp} size={0.5} />{formatBytes(s.bytesIn)}</span>
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </section>
    );
};
