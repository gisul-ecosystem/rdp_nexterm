import { useEffect, useState } from "react";
import Icon from "@mdi/react";
import { mdiAccessPointNetwork, mdiLanDisconnect, mdiEyeOutline } from "@mdi/js";
import { useTranslation } from "react-i18next";
import Button from "@/common/components/Button";
import ActionConfirmDialog from "@/common/components/ActionConfirmDialog";
import { formatDuration, userName } from "../../usageFormat.js";
import "./styles.sass";

export const LiveSessions = ({ sessions, onDisconnect }) => {
    const { t } = useTranslation();
    const [now, setNow] = useState(() => Date.now());
    const [confirming, setConfirming] = useState(null);

    useEffect(() => {
        if (!sessions.length) return;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [sessions.length]);

    return (
        <div className="usage-live">
            <div className="usage-live__header">
                <Icon path={mdiAccessPointNetwork} />
                <span>{t("usage.live.title")}</span>
                <span className="usage-live__count">{sessions.length}</span>
            </div>

            {sessions.length === 0 ? (
                <p className="usage-live__empty">{t("usage.live.empty")}</p>
            ) : (
                <div className="usage-live__list">
                    {sessions.map((session) => (
                        <div key={session.sessionId} className={`usage-live__item state-${session.state}`}>
                            <span className="usage-live__dot" />
                            <div className="usage-live__who">
                                <span className="usage-live__user">{userName(session.user)}</span>
                                <span className="usage-live__machine">
                                    {session.entryName || `#${session.entryId}`}
                                    {session.protocol && <span className="usage-live__protocol">{session.protocol}</span>}
                                </span>
                            </div>
                            <div className="usage-live__meta">
                                <span className="usage-live__duration">
                                    {formatDuration((now - new Date(session.startedAt).getTime()) / 1000)}
                                </span>
                                <span className="usage-live__state">
                                    {t(`usage.live.states.${session.state}`)}
                                    {session.state === "active" && (
                                        <span className="usage-live__viewers">
                                            <Icon path={mdiEyeOutline} />
                                            {t("usage.live.viewers", { count: session.viewers })}
                                        </span>
                                    )}
                                </span>
                            </div>
                            {session.canDisconnect && (
                                <Button type="danger" icon={mdiLanDisconnect} text={t("usage.live.disconnect")}
                                        onClick={() => setConfirming(session)} />
                            )}
                        </div>
                    ))}
                </div>
            )}

            <ActionConfirmDialog open={!!confirming} setOpen={(open) => !open && setConfirming(null)}
                                 text={confirming && t("usage.live.confirmDisconnect", {
                                     user: userName(confirming.user),
                                     machine: confirming.entryName || `#${confirming.entryId}`,
                                 })}
                                 onConfirm={() => onDisconnect(confirming.sessionId)} />
        </div>
    );
};
