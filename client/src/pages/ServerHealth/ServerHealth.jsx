import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { mdiHeartPulse, mdiRefresh, mdiTuneVariant } from "@mdi/js";
import { useTranslation } from "react-i18next";
import PageHeader from "@/common/components/PageHeader";
import Button from "@/common/components/Button";
import { useToast } from "@/common/contexts/ToastContext.jsx";
import { UserContext } from "@/common/contexts/UserContext.jsx";
import { StateStreamContext, STATE_TYPES } from "@/common/contexts/StateStreamContext.jsx";
import { getRequest, postRequest } from "@/common/utils/RequestUtil.js";
import { Permission } from "@/common/utils/permissions.js";
import { formatClock } from "@/common/utils/healthFormat.js";
import StatusHero from "./components/StatusHero";
import MetricCards from "./components/MetricCards";
import CapacityCard from "./components/CapacityCard";
import AlertsPanel from "./components/AlertsPanel";
import HistoryCharts from "./components/HistoryCharts";
import CapacityPlanning from "./components/CapacityPlanning";
import SessionsLoad from "./components/SessionsLoad";
import HealthSettingsDialog from "./components/HealthSettingsDialog";
import { usePolling } from "./usePolling.js";
import "./styles.sass";

const LIVE_REFRESH_MS = 5000;
const PLANNING_REFRESH_MS = 60000;
const HISTORY_REFRESH_MS = { "1h": 15000, "6h": 60000, "24h": 60000, "7d": 300000, "30d": 300000 };
const ALERT_PAGE = 20;

export const ServerHealth = () => {
    const { t } = useTranslation();
    const { sendToast } = useToast();
    const { hasPermission } = useContext(UserContext);
    const { registerHandler } = useContext(StateStreamContext);
    const canManage = hasPermission(Permission.SETTINGS_SERVER_HEALTH);

    const [live, setLive] = useState(null);
    const [range, setRange] = useState("1h");
    const [history, setHistory] = useState(null);
    const [planning, setPlanning] = useState(null);
    const [alertHistory, setAlertHistory] = useState({ alerts: [], total: 0 });
    const [settingsOpen, setSettingsOpen] = useState(false);
    const errorShown = useRef(false);
    const alertLimit = useRef(ALERT_PAGE);
    const alertKey = useRef(null);

    const loadAlertHistory = useCallback(async () => {
        try {
            setAlertHistory(await getRequest(`health/alerts?limit=${alertLimit.current}`));
        } catch {
            // Keep the previous list.
        }
    }, []);

    const loadLive = useCallback(async () => {
        try {
            const data = await getRequest("health/live");
            setLive(data);
            errorShown.current = false;
            const key = data.alerts.map((a) => `${a.id}:${a.severity}:${a.acknowledgedAt ? 1 : 0}`).join(",");
            if (key !== alertKey.current) {
                alertKey.current = key;
                loadAlertHistory();
            }
        } catch (error) {
            if (!errorShown.current) sendToast(t("common.error"), error?.message || t("health.errors.load"));
            errorShown.current = true;
        }
    }, [sendToast, t, loadAlertHistory]);

    const loadHistory = useCallback(async () => {
        try {
            setHistory(await getRequest(`health/history?range=${range}`));
        } catch {
            setHistory((current) => (current?.range === range ? current : { range, points: [] }));
        }
    }, [range]);

    const loadPlanning = useCallback(async () => {
        try {
            setPlanning(await getRequest(`health/capacity?tzOffset=${new Date().getTimezoneOffset()}`));
        } catch {
            // The next poll retries; the live view already reports load errors.
        }
    }, []);

    usePolling(loadLive, LIVE_REFRESH_MS);
    usePolling(loadHistory, HISTORY_REFRESH_MS[range]);
    usePolling(loadPlanning, PLANNING_REFRESH_MS);

    useEffect(() => {
        if (!registerHandler) return undefined;
        return registerHandler(STATE_TYPES.HEALTH_ALERTS, () => loadLive());
    }, [registerHandler, loadLive]);

    const closeSettings = useCallback(() => setSettingsOpen(false), []);

    const showMoreAlerts = () => {
        alertLimit.current += ALERT_PAGE;
        loadAlertHistory();
    };

    const refreshAll = () => Promise.all([loadLive(), loadHistory(), loadPlanning(), loadAlertHistory()]);

    const acknowledge = async (id) => {
        try {
            await postRequest(`health/alerts/${id}/acknowledge`);
            sendToast(t("common.success"), t("health.alerts.acknowledgedToast"));
            await loadLive();
        } catch (error) {
            sendToast(t("common.error"), error?.message || t("health.errors.acknowledge"));
        }
    };

    const onSettingsSaved = () => Promise.all([loadLive(), loadPlanning()]);

    return (
        <div className="health-page">
            <PageHeader icon={mdiHeartPulse} title={t("health.page.title")} subtitle={t("health.page.subtitle")}>
                {live?.now && <span className="health-updated">{t("health.page.updated", { time: formatClock(live.now) })}</span>}
                <Button type="secondary" icon={mdiRefresh} text={t("health.page.refresh")} onClick={refreshAll} />
                <Button icon={mdiTuneVariant} text={t("health.page.settings")} onClick={() => setSettingsOpen(true)} />
            </PageHeader>

            <div className="health-content">
                <StatusHero live={live} />

                {live?.ready ? (
                    <>
                        <MetricCards live={live} />
                        <div className="health-split">
                            <CapacityCard live={live} canManage={canManage} onOpenSettings={() => setSettingsOpen(true)} />
                            <AlertsPanel
                                active={live.alerts}
                                history={alertHistory}
                                onAcknowledge={acknowledge}
                                onShowMore={showMoreAlerts}
                            />
                        </div>
                        <HistoryCharts range={range} onRangeChange={setRange} history={history} live={live} />
                        <CapacityPlanning planning={planning} />
                        <SessionsLoad sessions={live.sessions} now={live.now} />
                    </>
                ) : live && (
                    <div className="health-collecting">
                        <span className="health-collecting-dot" />
                        {t("health.page.collecting")}
                    </div>
                )}
            </div>

            <HealthSettingsDialog
                open={settingsOpen}
                onClose={closeSettings}
                canManage={canManage}
                onSaved={onSettingsSaved}
            />
        </div>
    );
};
