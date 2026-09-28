import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mdiChartTimelineVariant, mdiDownload, mdiRefresh } from "@mdi/js";
import { useTranslation } from "react-i18next";
import PageHeader from "@/common/components/PageHeader";
import Button from "@/common/components/Button";
import { useToast } from "@/common/contexts/ToastContext.jsx";
import { getRequest, deleteRequest, getRawRequest } from "@/common/utils/RequestUtil.js";
import LiveSessions from "./components/LiveSessions";
import UsageSummary from "./components/UsageSummary";
import UsageFilters from "./components/UsageFilters";
import UsageTable from "./components/UsageTable";
import { DEFAULT_FILTERS, rangeToDates } from "./usageFormat.js";
import "./styles.sass";

const PAGE_SIZE = 50;
const LIVE_REFRESH_MS = 10000;
const EMPTY_USAGE = {
    sessions: [], total: 0, truncated: false,
    totals: { sessions: 0, live: 0, totalSeconds: 0, users: 0, machines: 0 }, byUser: [], byMachine: [],
};

const toQuery = (filters, extra = {}) => {
    const params = {
        ...rangeToDates(filters.range, filters.customFrom, filters.customTo),
        accountId: filters.accountId, entryId: filters.entryId, status: filters.status, ...extra,
    };
    return new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== ""));
};

export const Usage = () => {
    const { t } = useTranslation();
    const { sendToast } = useToast();
    const [filters, setFilters] = useState(DEFAULT_FILTERS);
    const [page, setPage] = useState(1);
    const [usage, setUsage] = useState(EMPTY_USAGE);
    const [live, setLive] = useState([]);
    const [options, setOptions] = useState(null);
    const [loading, setLoading] = useState(false);
    const liveIdsRef = useRef("");

    const loadUsage = useCallback(async () => {
        setLoading(true);
        try {
            const query = toQuery(filters, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
            setUsage(await getRequest(`usage/sessions?${query}`));
        } catch {
            sendToast(t("common.error"), t("usage.errors.load"));
            setUsage(EMPTY_USAGE);
        } finally {
            setLoading(false);
        }
    }, [filters, page, sendToast, t]);

    const loadLive = useCallback(async () => {
        try {
            const sessions = await getRequest("usage/live");
            setLive(sessions);
            return sessions.map((s) => s.sessionId).sort().join(",");
        } catch {
            return liveIdsRef.current;
        }
    }, []);

    const refresh = useCallback(async () => {
        liveIdsRef.current = await loadLive();
        await loadUsage();
    }, [loadLive, loadUsage]);

    useEffect(() => {
        loadUsage();
    }, [loadUsage]);

    useEffect(() => {
        getRequest("usage/options").then(setOptions).catch(() => setOptions(null));
    }, []);

    // Session history only changes when someone connects or disconnects, which shows up in the live list.
    useEffect(() => {
        let cancelled = false;
        const poll = async () => {
            const ids = await loadLive();
            if (cancelled) return;
            if (ids !== liveIdsRef.current) {
                liveIdsRef.current = ids;
                loadUsage();
            }
        };
        poll();
        const timer = setInterval(poll, LIVE_REFRESH_MS);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [loadLive, loadUsage]);

    const handleFilterChange = useCallback((changes) => {
        setFilters((prev) => ({ ...prev, ...changes }));
        setPage(1);
    }, []);

    const disconnect = async (sessionId) => {
        try {
            await deleteRequest(`usage/live/${sessionId}`);
            sendToast(t("common.success"), t("usage.live.disconnected"));
        } catch (error) {
            sendToast(t("common.error"), error?.message || t("usage.errors.disconnect"));
        }
        refresh();
    };

    const exportCsv = async () => {
        try {
            const response = await getRawRequest(`usage/sessions.csv?${toQuery(filters)}`);
            const url = URL.createObjectURL(await response.blob());
            const link = document.createElement("a");
            link.href = url;
            link.download = `nexterm-usage-${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
        } catch {
            sendToast(t("common.error"), t("usage.errors.export"));
        }
    };

    const pagination = useMemo(() => ({ total: usage.total, currentPage: page, itemsPerPage: PAGE_SIZE }), [usage.total, page]);

    return (
        <div className="usage-page">
            <PageHeader icon={mdiChartTimelineVariant} title={t("usage.page.title")} subtitle={t("usage.page.subtitle")}>
                <Button type="secondary" icon={mdiRefresh} text={t("usage.page.refresh")} onClick={refresh} />
                <Button icon={mdiDownload} text={t("usage.page.exportCsv")} onClick={exportCsv} disabled={!usage.total} />
            </PageHeader>
            <div className="usage-content">
                <LiveSessions sessions={live} onDisconnect={disconnect} />
                <UsageFilters filters={filters} options={options} onChange={handleFilterChange} />
                <UsageSummary totals={usage.totals} byUser={usage.byUser} byMachine={usage.byMachine} />
                {usage.truncated && <p className="usage-content__notice">{t("usage.page.truncated")}</p>}
                <UsageTable sessions={usage.sessions} loading={loading} pagination={pagination} onPageChange={setPage} />
            </div>
        </div>
    );
};
