import Icon from "@mdi/react";
import {
    mdiAlertCircleOutline, mdiAlertOctagonOutline, mdiCheckCircleOutline, mdiChip, mdiClockOutline, mdiEthernet,
    mdiHarddisk, mdiLanConnect, mdiLanDisconnect, mdiMemory, mdiPackageVariantClosed, mdiServerOutline,
} from "@mdi/js";
import { useTranslation } from "react-i18next";
import { formatBytes, formatMbps, formatPct, formatUptime } from "@/common/utils/healthFormat.js";
import "./styles.sass";

const STATUS_ICON = { ok: mdiCheckCircleOutline, warning: mdiAlertCircleOutline, critical: mdiAlertOctagonOutline };

const Fact = ({ icon, children, level }) => (
    <span className={`health-fact${level ? ` health-level-${level} health-fact--level` : ""}`}>
        <Icon path={icon} size={0.65} />
        {children}
    </span>
);

export const StatusHero = ({ live }) => {
    const { t } = useTranslation();

    if (!live) {
        return (
            <div className="health-hero health-hero--loading">
                <div className="health-hero-skeleton health-hero-skeleton--icon" />
                <div className="health-hero-skeleton-lines">
                    <div className="health-hero-skeleton" />
                    <div className="health-hero-skeleton health-hero-skeleton--short" />
                </div>
            </div>
        );
    }

    const { status, alerts, host, nexterm, sample } = live;
    const critical = alerts.filter((a) => a.severity === "critical").length;
    const warning = alerts.length - critical;
    const title = critical ? t("health.status.critical", { count: critical })
        : warning ? t("health.status.warning", { count: warning })
        : t("health.status.ok");
    const subtitle = critical && warning ? `${t("health.status.warning", { count: warning })} · ${t("health.status.problemHint")}`
        : status === "ok" ? t("health.status.okHint") : t("health.status.problemHint");
    const iface = host.primaryInterface || host.defaultInterface || "–";

    return (
        <section className={`health-hero health-level-${status}`}>
            <div className="health-hero-status">
                <div className="health-hero-icon">
                    <Icon path={STATUS_ICON[status]} size={1.4} />
                </div>
                <div className="health-hero-text">
                    <span className="health-hero-label">{host.serverLabel}</span>
                    <h2>{title}</h2>
                    <p>{subtitle}</p>
                </div>
            </div>

            <div className="health-hero-facts">
                <Fact icon={mdiChip}>{t("health.host.cpus", { count: host.cpus })}</Fact>
                {sample && <Fact icon={mdiMemory}>{t("health.host.memory", { value: formatBytes(sample.memTotal, 0) })}</Fact>}
                {sample && <Fact icon={mdiHarddisk}>{t("health.host.disk", { value: formatBytes(sample.diskTotal, 0) })}</Fact>}
                <Fact icon={mdiEthernet} level={host.linkMbps ? null : "warning"}>
                    {host.linkMbps
                        ? t("health.host.link", { iface, speed: formatMbps(host.linkMbps) })
                        : t("health.host.linkUnknown", { iface })}
                </Fact>
                <Fact icon={mdiClockOutline}>{t("health.host.uptime", { value: formatUptime(host.uptime) })}</Fact>
                <Fact icon={mdiPackageVariantClosed}>{t("health.host.version", { version: nexterm.version })}</Fact>
                <Fact icon={nexterm.engineConnected ? mdiLanConnect : mdiLanDisconnect} level={nexterm.engineConnected ? "ok" : "critical"}>
                    {t(nexterm.engineConnected ? "health.host.engineOnline" : "health.host.engineOffline")}
                </Fact>
                {sample && (
                    <Fact icon={mdiServerOutline}>
                        {t("health.metrics.nexterm")}: {t("health.metrics.nextermSub", {
                            server: `${formatPct(sample.serverCpu)} · ${formatBytes(sample.serverRss, 0)}`,
                            engine: `${formatPct(sample.engineCpu)} · ${formatBytes(sample.engineRss, 0)}`,
                        })}
                    </Fact>
                )}
            </div>
        </section>
    );
};
