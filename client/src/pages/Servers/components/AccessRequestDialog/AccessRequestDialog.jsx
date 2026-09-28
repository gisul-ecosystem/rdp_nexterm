import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { DialogProvider } from "@/common/components/Dialog";
import Button from "@/common/components/Button";
import "./styles.sass";

const holderLabel = (holder) => {
    if (!holder) return "another user";
    const name = [holder.firstName, holder.lastName].filter(Boolean).join(" ").trim();
    return name || holder.username || `user #${holder.id}`;
};

const deviceLabel = (device) => {
    if (!device) return "another device";
    return device.ip ? `${device.label}, ${device.ip}` : device.label;
};

const useSecondsLeft = (open, expiresAt) => {
    const [secondsLeft, setSecondsLeft] = useState(null);

    useEffect(() => {
        if (!open || !expiresAt) {
            setSecondsLeft(null);
            return;
        }
        const tick = () => {
            const left = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000));
            setSecondsLeft(left);
        };
        tick();
        const id = setInterval(tick, 500);
        return () => clearInterval(id);
    }, [open, expiresAt]);

    return secondsLeft;
};

export const AccessWaitingDialog = ({ open, holder, sameAccount, holderDevice, entryName, expiresAt, onCancel }) => {
    const { t } = useTranslation();
    const secondsLeft = useSecondsLeft(open, expiresAt);

    return (
        <DialogProvider open={open} onClose={onCancel}>
            <div className="access-request-dialog">
                <h2>{t("servers.accessRequest.waitingTitle", { defaultValue: "Waiting for approval" })}</h2>
                <p>
                    {sameAccount
                        ? t("servers.accessRequest.waitingBodySameAccount", {
                            defaultValue: "{{entry}} is in use by someone else signed in as {{user}} ({{device}}). Waiting for them to Allow or Deny.",
                            entry: entryName || "This VM",
                            user: holder?.username || "this account",
                            device: deviceLabel(holderDevice),
                        })
                        : t("servers.accessRequest.waitingBody", {
                            defaultValue: "{{entry}} is in use by {{user}}. Waiting for them to Allow or Deny.",
                            entry: entryName || "This VM",
                            user: holderLabel(holder),
                        })}
                </p>
                {secondsLeft !== null && (
                    <p className="access-request-timer">
                        {t("servers.accessRequest.timeout", {
                            defaultValue: "Times out in {{seconds}}s",
                            seconds: secondsLeft,
                        })}
                    </p>
                )}
                <div className="dialog-actions">
                    <Button type="secondary" text={t("common.actions.cancel", { defaultValue: "Cancel" })} onClick={onCancel} />
                </div>
            </div>
        </DialogProvider>
    );
};

export const AccessApproveDialog = ({ open, request, onAllow, onDeny }) => {
    const { t } = useTranslation();
    const secondsLeft = useSecondsLeft(open, request?.expiresAt);

    return (
        <DialogProvider open={open} onClose={onDeny}>
            <div className="access-request-dialog">
                <h2>{t("servers.accessRequest.approveTitle", { defaultValue: "Connection request" })}</h2>
                <p>
                    {request?.sameAccount
                        ? t("servers.accessRequest.approveBodySameAccount", {
                            defaultValue: "Someone else signed in as {{user}} on {{device}} wants to take over {{entry}}. Allowing will disconnect you.",
                            user: request?.requester?.username || "this account",
                            device: deviceLabel(request?.requesterDevice),
                            entry: request?.holderEntryName || request?.entryName || "this VM",
                        })
                        : t("servers.accessRequest.approveBody", {
                            defaultValue: "{{user}} wants to take over {{entry}}. Allowing will disconnect you.",
                            user: holderLabel(request?.requester),
                            entry: request?.holderEntryName || request?.entryName || "this VM",
                        })}
                </p>
                {secondsLeft !== null && (
                    <p className="access-request-timer">
                        {t("servers.accessRequest.timeout", {
                            defaultValue: "Times out in {{seconds}}s",
                            seconds: secondsLeft,
                        })}
                    </p>
                )}
                <div className="dialog-actions">
                    <Button type="secondary" text={t("servers.accessRequest.deny", { defaultValue: "Deny" })} onClick={onDeny} />
                    <Button type="primary" text={t("servers.accessRequest.allow", { defaultValue: "Allow" })} onClick={onAllow} />
                </div>
            </div>
        </DialogProvider>
    );
};
