import Icon from "@mdi/react";
import { mdiTimerOutline, mdiHistory, mdiAccountGroupOutline, mdiServerNetwork } from "@mdi/js";
import { useTranslation } from "react-i18next";
import { formatDuration, userName, machineName } from "../../usageFormat.js";
import "./styles.sass";

const Breakdown = ({ title, items, label }) => {
    const { t } = useTranslation();
    const top = items.slice(0, 6);
    const max = Math.max(1, ...top.map((item) => item.seconds));

    return (
        <div className="usage-breakdown">
            <h3>{title}</h3>
            {top.length === 0 ? (
                <p className="usage-breakdown__empty">{t("usage.summary.empty")}</p>
            ) : top.map((item, index) => (
                <div key={index} className="usage-breakdown__row">
                    <div className="usage-breakdown__label">
                        <span className="usage-breakdown__name">{label(item)}</span>
                        <span className="usage-breakdown__value">
                            {formatDuration(item.seconds)}
                            <span>{t("usage.summary.sessionCount", { count: item.sessions })}</span>
                        </span>
                    </div>
                    <div className="usage-breakdown__bar">
                        <span style={{ width: `${(item.seconds / max) * 100}%` }} />
                    </div>
                </div>
            ))}
        </div>
    );
};

export const UsageSummary = ({ totals, byUser, byMachine }) => {
    const { t } = useTranslation();

    const cards = [
        { icon: mdiTimerOutline, label: t("usage.summary.totalTime"), value: formatDuration(totals.totalSeconds) },
        {
            icon: mdiHistory, label: t("usage.summary.sessions"), value: totals.sessions,
            extra: totals.live > 0 ? t("usage.summary.liveCount", { count: totals.live }) : null,
        },
        { icon: mdiAccountGroupOutline, label: t("usage.summary.users"), value: totals.users },
        { icon: mdiServerNetwork, label: t("usage.summary.machines"), value: totals.machines },
    ];

    return (
        <div className="usage-summary">
            <div className="usage-summary__cards">
                {cards.map((card) => (
                    <div key={card.label} className="usage-card">
                        <Icon path={card.icon} />
                        <div>
                            <span className="usage-card__value">{card.value}</span>
                            <span className="usage-card__label">
                                {card.label}
                                {card.extra && <em>{card.extra}</em>}
                            </span>
                        </div>
                    </div>
                ))}
            </div>
            <div className="usage-summary__breakdowns">
                <Breakdown title={t("usage.summary.byUser")} items={byUser} label={(item) => userName(item.user)} />
                <Breakdown title={t("usage.summary.byMachine")} items={byMachine} label={(item) => machineName(item, t)} />
            </div>
        </div>
    );
};
