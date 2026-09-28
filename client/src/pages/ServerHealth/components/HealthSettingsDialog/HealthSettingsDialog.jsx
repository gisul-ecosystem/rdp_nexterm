import { useEffect, useMemo, useState } from "react";
import Icon from "@mdi/react";
import { mdiBellRingOutline, mdiCogOutline, mdiEthernet, mdiLockOutline, mdiSend, mdiTag, mdiTuneVertical, mdiWebhook } from "@mdi/js";
import { useTranslation } from "react-i18next";
import { DialogProvider } from "@/common/components/Dialog";
import Button from "@/common/components/Button";
import IconInput from "@/common/components/IconInput";
import SelectBox from "@/common/components/SelectBox";
import TabSwitcher from "@/common/components/TabSwitcher";
import ToggleSwitch from "@/common/components/ToggleSwitch";
import { useToast } from "@/common/contexts/ToastContext.jsx";
import { getRequest, patchRequest, postRequest } from "@/common/utils/RequestUtil.js";
import { formatClock } from "@/common/utils/healthFormat.js";
import "./styles.sass";

const RULE_ORDER = ["cpu", "memory", "disk", "bandwidth", "steal", "lag", "capacity", "engine"];
const RULE_UNIT = { cpu: "%", memory: "%", disk: "%", bandwidth: "%", steal: "%", lag: "ms", capacity: "", engine: "s" };
const FORMATS = ["teams", "slack", "googlechat", "generic"];
const RETENTION = [7, 14, 30, 60, 90];

const toForm = (s) => ({
    serverLabel: s.serverLabel || "",
    linkMbps: s.linkMbps ? String(s.linkMbps) : "",
    primaryInterface: s.primaryInterface || "",
    retentionDays: s.retentionDays,
    rules: s.rules,
    webhookEnabled: s.webhookEnabled,
    webhookFormat: s.webhookFormat,
    notifyResolved: s.notifyResolved,
    webhookUrl: "",
    clearWebhook: false,
});

const numberOrNull = (value) => (value === "" || value === null || value === undefined ? null : Number(value));

const NumberField = ({ value, onChange, unit, disabled, min = 0, label }) => (
    <label className="health-number">
        <input
            type="number"
            min={min}
            value={value ?? ""}
            disabled={disabled}
            aria-label={label}
            onChange={(e) => onChange(numberOrNull(e.target.value))}
        />
        {unit && <span>{unit}</span>}
    </label>
);

export const HealthSettingsDialog = ({ open, onClose, canManage, onSaved }) => {
    const { t } = useTranslation();
    const { sendToast } = useToast();
    const [tab, setTab] = useState("general");
    const [settings, setSettings] = useState(null);
    const [form, setForm] = useState(null);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);

    const close = () => {
        setTab("general");
        onClose();
    };

    useEffect(() => {
        if (!open) return;
        getRequest("health/settings")
            .then((data) => {
                setSettings(data);
                setForm(toForm(data));
            })
            .catch((error) => {
                sendToast(t("common.error"), error?.message || t("health.errors.load"));
                onClose();
            });
    }, [open, onClose, sendToast, t]);

    const initial = useMemo(() => (settings ? JSON.stringify(toForm(settings)) : null), [settings]);
    const isDirty = !!form && JSON.stringify(form) !== initial;
    const readOnly = !canManage;

    const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
    const setRule = (key, field, value) => setForm((f) => ({ ...f, rules: { ...f.rules, [key]: { ...f.rules[key], [field]: value } } }));

    const save = async (e) => {
        e.preventDefault();
        if (readOnly) return;
        setSaving(true);
        try {
            const body = {
                serverLabel: form.serverLabel.trim(),
                linkMbps: numberOrNull(form.linkMbps),
                primaryInterface: form.primaryInterface,
                retentionDays: form.retentionDays,
                rules: Object.fromEntries(RULE_ORDER.map((key) => {
                    const { enabled, warning, critical, minutes } = form.rules[key];
                    const rule = { enabled, critical, minutes };
                    if (!settings.ruleMeta[key].criticalOnly) rule.warning = warning;
                    return [key, rule];
                })),
                webhookEnabled: form.webhookEnabled,
                webhookFormat: form.webhookFormat,
                notifyResolved: form.notifyResolved,
            };
            if (form.webhookUrl.trim()) body.webhookUrl = form.webhookUrl.trim();
            else if (form.clearWebhook) body.webhookUrl = null;

            const saved = await patchRequest("health/settings", body);
            setSettings(saved);
            setForm(toForm(saved));
            sendToast(t("common.success"), t("health.settings.saved"));
            onSaved?.();
            close();
        } catch (error) {
            sendToast(t("common.error"), error?.message || t("health.settings.saveFailed"));
        } finally {
            setSaving(false);
        }
    };

    const sendTest = async () => {
        setTesting(true);
        try {
            const body = { webhookFormat: form.webhookFormat };
            if (form.webhookUrl.trim()) body.webhookUrl = form.webhookUrl.trim();
            await postRequest("health/settings/test-webhook", body);
            sendToast(t("common.success"), t("health.settings.testSent"));
        } catch (error) {
            sendToast(t("common.error"), error?.message);
        } finally {
            setTesting(false);
        }
    };

    const tabs = [
        { key: "general", label: t("health.settings.general"), icon: mdiCogOutline },
        { key: "rules", label: t("health.settings.rules"), icon: mdiTuneVertical },
        { key: "notifications", label: t("health.settings.notifications"), icon: mdiBellRingOutline },
    ];

    const interfaceOptions = settings ? [
        { value: "", label: t("health.settings.primaryAuto", { iface: settings.defaultInterface || "–" }) },
        ...settings.interfaces.map((name) => ({ value: name, label: name })),
    ] : [];
    const canTest = !readOnly && (form?.webhookUrl.trim() || (settings?.webhookConfigured && !form?.clearWebhook));
    const status = settings?.webhookStatus;

    return (
        <DialogProvider open={open} onClose={close} isDirty={isDirty && !readOnly}>
            <form className="health-settings" onSubmit={save}>
                <div className="health-settings-header">
                    <h2>{t("health.settings.title")}</h2>
                    <TabSwitcher tabs={tabs} activeTab={tab} onTabChange={setTab} />
                </div>

                {readOnly && (
                    <div className="health-settings-readonly">
                        <Icon path={mdiLockOutline} size={0.7} />
                        {t("health.settings.readOnly")}
                    </div>
                )}

                {!form ? <div className="health-settings-loading" /> : (
                    <fieldset className="health-settings-body" disabled={readOnly}>
                        {tab === "general" && (
                            <div className="health-settings-section">
                                <div className="health-field">
                                    <label htmlFor="health-server-label">{t("health.settings.serverLabel")}</label>
                                    <IconInput
                                        id="health-server-label" icon={mdiTag} value={form.serverLabel} disabled={readOnly}
                                        placeholder={t("health.settings.serverLabelPlaceholder")} setValue={(v) => set("serverLabel", v)}
                                    />
                                </div>
                                <div className="health-field">
                                    <label htmlFor="health-link">{t("health.settings.linkMbps")}</label>
                                    <IconInput
                                        id="health-link" type="number" icon={mdiEthernet} value={form.linkMbps} disabled={readOnly}
                                        placeholder={settings.detectedLinkMbps ? String(settings.detectedLinkMbps) : "1000"}
                                        setValue={(v) => set("linkMbps", v)}
                                    />
                                    <span className="health-field-hint">
                                        {t("health.settings.linkMbpsHint")}{" "}
                                        {settings.detectedLinkMbps
                                            ? t("health.settings.linkDetected", { value: settings.detectedLinkMbps })
                                            : t("health.settings.linkNotDetected")}
                                    </span>
                                </div>
                                <div className="health-field-row">
                                    <div className="health-field">
                                        <label>{t("health.settings.primaryInterface")}</label>
                                        <SelectBox
                                            options={interfaceOptions} selected={form.primaryInterface} disabled={readOnly}
                                            setSelected={(v) => set("primaryInterface", v)}
                                        />
                                    </div>
                                    <div className="health-field">
                                        <label>{t("health.settings.retentionDays")}</label>
                                        <SelectBox
                                            options={RETENTION.map((d) => ({ value: d, label: `${d} ${t("health.settings.days")}` }))}
                                            selected={form.retentionDays} disabled={readOnly}
                                            setSelected={(v) => set("retentionDays", v)}
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        {tab === "rules" && (
                            <div className="health-rules">
                                <div className="health-rule health-rule-head">
                                    <span>{t("health.settings.rule")}</span>
                                    <span>{t("health.settings.warning")}</span>
                                    <span>{t("health.settings.critical")}</span>
                                    <span>{t("health.settings.forMinutes")}</span>
                                </div>
                                {RULE_ORDER.map((key) => {
                                    const rule = form.rules[key];
                                    const meta = settings.ruleMeta[key];
                                    const off = !rule.enabled;
                                    return (
                                        <div key={key} className={`health-rule${off ? " is-off" : ""}`}>
                                            <div className="health-rule-name">
                                                <ToggleSwitch
                                                    id={`health-rule-${key}`} checked={rule.enabled} disabled={readOnly}
                                                    onChange={(v) => setRule(key, "enabled", v)}
                                                />
                                                <div>
                                                    <label htmlFor={`health-rule-${key}`}>{t(`health.rules.${key}`)}</label>
                                                    <span>{t(`health.ruleHints.${key}`)}</span>
                                                </div>
                                            </div>
                                            {meta.criticalOnly ? <span className="health-rule-na">–</span> : (
                                                <NumberField
                                                    label={t("health.settings.warning")} value={rule.warning} unit={RULE_UNIT[key]}
                                                    disabled={readOnly || off} onChange={(v) => setRule(key, "warning", v)}
                                                />
                                            )}
                                            <NumberField
                                                label={t("health.settings.critical")} value={rule.critical} unit={RULE_UNIT[key]}
                                                disabled={readOnly || off} onChange={(v) => setRule(key, "critical", v)}
                                            />
                                            {meta.criticalOnly ? <span className="health-rule-na">–</span> : (
                                                <NumberField
                                                    label={t("health.settings.forMinutes")} value={rule.minutes} unit={t("health.settings.minutes")}
                                                    disabled={readOnly || off} onChange={(v) => setRule(key, "minutes", v ?? 0)}
                                                />
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {tab === "notifications" && (
                            <div className="health-settings-section">
                                <p className="health-field-hint">{t("health.settings.notificationsHint")}</p>
                                <div className="health-toggle-row">
                                    <label htmlFor="health-webhook-enabled">{t("health.settings.webhookEnabled")}</label>
                                    <ToggleSwitch
                                        id="health-webhook-enabled" checked={form.webhookEnabled} disabled={readOnly}
                                        onChange={(v) => set("webhookEnabled", v)}
                                    />
                                </div>
                                <div className="health-field">
                                    <label>{t("health.settings.webhookFormat")}</label>
                                    <SelectBox
                                        options={FORMATS.map((f) => ({ value: f, label: t(`health.settings.formats.${f}`) }))}
                                        selected={form.webhookFormat} disabled={readOnly}
                                        setSelected={(v) => set("webhookFormat", v)}
                                    />
                                </div>
                                <div className="health-field">
                                    <label htmlFor="health-webhook-url">{t("health.settings.webhookUrl")}</label>
                                    <IconInput
                                        id="health-webhook-url" type="url" icon={mdiWebhook} value={form.webhookUrl} disabled={readOnly}
                                        autoComplete="off" placeholder="https://…" setValue={(v) => set("webhookUrl", v)}
                                    />
                                    {settings.webhookConfigured && !form.clearWebhook && (
                                        <span className="health-field-hint">
                                            {t("health.settings.webhookUrlSaved", { host: settings.webhookHost })}
                                            {!readOnly && (
                                                <button type="button" className="health-link-button" onClick={() => set("clearWebhook", true)}>
                                                    {t("health.settings.clearWebhook")}
                                                </button>
                                            )}
                                        </span>
                                    )}
                                </div>
                                <div className="health-toggle-row">
                                    <label htmlFor="health-notify-resolved">{t("health.settings.notifyResolved")}</label>
                                    <ToggleSwitch
                                        id="health-notify-resolved" checked={form.notifyResolved} disabled={readOnly}
                                        onChange={(v) => set("notifyResolved", v)}
                                    />
                                </div>
                                <div className="health-webhook-footer">
                                    <Button
                                        type="secondary" buttonType="button" icon={mdiSend} text={t("health.settings.test")}
                                        disabled={!canTest || testing} onClick={sendTest}
                                    />
                                    {status?.lastError && (
                                        <span className="health-webhook-status is-error">
                                            {t("health.settings.lastError", { error: status.lastError })}
                                        </span>
                                    )}
                                    {!status?.lastError && status?.lastSentAt && (
                                        <span className="health-webhook-status">
                                            {t("health.settings.lastSent", { time: formatClock(status.lastSentAt) })}
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}
                    </fieldset>
                )}

                <div className="dialog-actions">
                    <Button text={t("common.cancel")} type="secondary" buttonType="button" onClick={close} />
                    {!readOnly && <Button text={t("health.settings.save")} type="primary" buttonType="submit" disabled={!isDirty || saving} />}
                </div>
            </form>
        </DialogProvider>
    );
};
