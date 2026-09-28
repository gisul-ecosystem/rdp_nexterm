import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import SelectBox from "@/common/components/SelectBox";
import DateInput from "@/common/components/DateInput";
import Button from "@/common/components/Button";
import { RANGE_PRESETS, DEFAULT_FILTERS, userName, machineName } from "../../usageFormat.js";
import "./styles.sass";

export const UsageFilters = ({ filters, options, onChange }) => {
    const { t } = useTranslation();

    const rangeOptions = useMemo(() =>
        RANGE_PRESETS.map((value) => ({ value, label: t(`usage.filters.ranges.${value}`) })), [t]);

    const userOptions = useMemo(() => [
        { value: "", label: t("usage.filters.allUsers") },
        ...(options?.users || []).map((user) => ({ value: String(user.id), label: userName(user) })),
    ], [options, t]);

    const machineOptions = useMemo(() => [
        { value: "", label: t("usage.filters.allMachines") },
        ...(options?.machines || []).map((machine) => ({ value: String(machine.entryId), label: machineName(machine, t) })),
    ], [options, t]);

    const statusOptions = useMemo(() => [
        { value: "", label: t("usage.filters.allStatuses") },
        ...["live", "ended", "unknown"].map((value) => ({ value, label: t(`usage.status.${value}`) })),
    ], [t]);

    const isDefault = Object.entries(DEFAULT_FILTERS).every(([key, value]) => filters[key] === value);

    return (
        <div className="usage-filters">
            <div className="usage-filters__group">
                <label>{t("usage.filters.range")}</label>
                <SelectBox options={rangeOptions} selected={filters.range}
                           setSelected={(range) => onChange({ range })} />
            </div>

            {filters.range === "custom" && (
                <>
                    <div className="usage-filters__group">
                        <label>{t("usage.filters.from")}</label>
                        <DateInput value={filters.customFrom} max={filters.customTo || undefined}
                                   setValue={(customFrom) => onChange({ customFrom })} />
                    </div>
                    <div className="usage-filters__group">
                        <label>{t("usage.filters.to")}</label>
                        <DateInput value={filters.customTo} min={filters.customFrom || undefined}
                                   setValue={(customTo) => onChange({ customTo })} />
                    </div>
                </>
            )}

            <div className="usage-filters__group">
                <label>{t("usage.filters.user")}</label>
                <SelectBox options={userOptions} selected={filters.accountId} searchable
                           setSelected={(accountId) => onChange({ accountId })} />
            </div>

            <div className="usage-filters__group">
                <label>{t("usage.filters.machine")}</label>
                <SelectBox options={machineOptions} selected={filters.entryId} searchable
                           setSelected={(entryId) => onChange({ entryId })} />
            </div>

            <div className="usage-filters__group">
                <label>{t("usage.filters.status")}</label>
                <SelectBox options={statusOptions} selected={filters.status}
                           setSelected={(status) => onChange({ status })} />
            </div>

            {!isDefault && (
                <div className="usage-filters__group usage-filters__actions">
                    <Button text={t("usage.filters.clear")} type="secondary" onClick={() => onChange(DEFAULT_FILTERS)} />
                </div>
            )}
        </div>
    );
};
