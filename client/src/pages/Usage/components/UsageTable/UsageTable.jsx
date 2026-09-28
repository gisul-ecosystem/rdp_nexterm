import { useState, useMemo } from "react";
import Icon from "@mdi/react";
import { mdiChevronRight, mdiInformationOutline, mdiAccountCircleOutline, mdiMonitorAccount, mdiTimerOutline } from "@mdi/js";
import { useTranslation } from "react-i18next";
import PaginatedTable from "@/common/components/PaginatedTable";
import { formatDuration, formatDateTime, userName, machineName, browserName, reasonBadge } from "../../usageFormat.js";
import "./styles.sass";

const DateCell = ({ value, fallback }) => {
    const formatted = formatDateTime(value);
    if (!formatted) return <span className="usage-table__muted">{fallback}</span>;
    return (
        <div className="usage-table__datetime">
            <span>{formatted.date}</span>
            <span className="usage-table__time">{formatted.time}</span>
        </div>
    );
};

const EndBadge = ({ row }) => {
    const { t } = useTranslation();
    if (row.status === "live") return <span className="usage-badge green live">{t("usage.status.live")}</span>;
    if (row.status === "unknown") return <span className="usage-badge gray">{t("usage.status.unknown")}</span>;
    const { color, label } = reasonBadge(row.closeReason || "ended", t);
    return <span className={`usage-badge ${color}`} title={row.closeDetail || undefined}>{label}</span>;
};

const Details = ({ row }) => {
    const { t } = useTranslation();
    const lastSeen = formatDateTime(row.lastSeenAt);
    const items = [
        [t("usage.table.details.ipAddress"), row.ipAddress],
        [t("usage.table.details.browser"), browserName(row.userAgent)],
        [t("usage.table.details.lastSeen"), lastSeen && `${lastSeen.date} ${lastSeen.time}`],
        [t("usage.table.details.closeDetail"), row.closeDetail],
        [t("usage.table.details.connectionReason"), row.connectionReason],
        [t("usage.table.details.auditId"), `#${row.id}`],
    ].filter(([, value]) => value);

    return (
        <div className="usage-table__details">
            {items.map(([label, value]) => (
                <div key={label} className="usage-table__detail">
                    <span>{label}</span>
                    <span>{value}</span>
                </div>
            ))}
        </div>
    );
};

export const UsageTable = ({ sessions, loading, pagination, onPageChange }) => {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(null);

    const columns = useMemo(() => [
        { key: "user", label: t("usage.table.user"), icon: mdiAccountCircleOutline },
        { key: "machine", label: t("usage.table.machine"), icon: mdiMonitorAccount },
        { key: "login", label: t("usage.table.login") },
        { key: "logout", label: t("usage.table.logout") },
        { key: "duration", label: t("usage.table.duration"), icon: mdiTimerOutline },
        { key: "ended", label: t("usage.table.ended") },
    ], [t]);

    const renderRow = (row) => (
        <div key={row.id} className="table-row">
            <div className="usage-table__row" onClick={() => setExpanded((id) => id === row.id ? null : row.id)}>
                <div className="cell" data-label={t("usage.table.user")}>
                    <span className="usage-table__strong">{userName(row.user)}</span>
                </div>
                <div className="cell" data-label={t("usage.table.machine")}>
                    <span className={`usage-table__machine${row.entryDeleted ? " deleted" : ""}`}>
                        {machineName(row, t)}
                    </span>
                    <span className="usage-table__protocol">{row.protocol}</span>
                </div>
                <div className="cell" data-label={t("usage.table.login")}>
                    <DateCell value={row.loginAt} />
                </div>
                <div className="cell" data-label={t("usage.table.logout")}>
                    <DateCell value={row.logoutAt}
                              fallback={row.status === "live" ? t("usage.table.stillOpen") : t("usage.table.notRecorded")} />
                </div>
                <div className="cell" data-label={t("usage.table.duration")}>
                    <span className="usage-table__duration">{formatDuration(row.durationSeconds)}</span>
                </div>
                <div className="cell usage-table__end" data-label={t("usage.table.ended")}>
                    <EndBadge row={row} />
                    <Icon path={mdiChevronRight} className={`usage-table__chevron${expanded === row.id ? " open" : ""}`} />
                </div>
            </div>
            {expanded === row.id && <Details row={row} />}
        </div>
    );

    return (
        <PaginatedTable data={sessions} columns={columns} pagination={pagination} onPageChange={onPageChange}
                        renderRow={renderRow} getRowKey={(row) => row.id} loading={loading}
                        emptyState={{
                            icon: mdiInformationOutline,
                            title: t("usage.table.empty.title"),
                            subtitle: t("usage.table.empty.subtitle"),
                        }}
                        className="usage-table" />
    );
};
