import { useState } from "react";
import { Webhook } from "lucide-react";
import { Button, Dialog, Field, Input } from "@/components/ui";
import { useT } from "@/i18n/react";
import { createWebhook, updateEventConsumer } from "@/features/events/api";
import { actionError, endpointProblem, tightSubscription, webhookChange } from "@/features/events/model";
import { SubscriptionPicker } from "@/features/events/components/SubscriptionPicker";
import type { EventConsumer, SubscriptionPattern } from "@/features/events/types";

/**
 * Add a webhook, or edit one: its name, its endpoint and what it receives.
 * A new one comes with its Signing Secret, the only time it is seen.
 */
export function WebhookDialog({
  consumer,
  onClose,
  onSaved,
}: {
  consumer?: EventConsumer;
  onClose: () => void;
  onSaved: (saved: { consumer: EventConsumer; signingSecret?: string }) => void;
}) {
  const t = useT("events");
  const common = useT("common");
  const [name, setName] = useState(consumer?.name ?? "");
  const [url, setUrl] = useState(consumer?.webhook?.url ?? "");
  const [subscription, setSubscription] = useState<SubscriptionPattern[]>(consumer ? tightSubscription(consumer.subscription) : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const urlProblem = endpointProblem(url);
  const problem = !name.trim() ? "name" : urlProblem ? "url" : subscription.length === 0 ? "events" : null;

  async function submit() {
    if (problem) return;
    setBusy(true);
    setError(null);
    const fields = { name: name.trim(), url: url.trim(), subscription };
    try {
      if (!consumer) return onSaved(await createWebhook(fields));
      const change = webhookChange(consumer, fields);
      onSaved({ consumer: Object.keys(change).length > 0 ? await updateEventConsumer(consumer.id, change) : consumer });
    } catch (cause) {
      setError(actionError(cause, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      onClose={onClose}
      title={consumer ? t("webhook.edit_title", { name: consumer.name }) : t("webhook.create_title")}
      description={consumer ? undefined : t("webhook.create_body")}
      icon={<Webhook size={18} />}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{common("cancel")}</Button>
          <Button onClick={() => void submit()} disabled={busy || problem !== null}>{t(consumer ? "webhook.save" : "webhook.create_submit")}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t("webhook.name")}>
          <Input value={name} maxLength={80} placeholder={t("webhook.name_placeholder")} onChange={(event) => setName(event.currentTarget.value)} />
        </Field>
        <Field label={t("webhook.url")} hint={t("webhook.url_hint")} error={url && urlProblem ? t(`webhook.url_problem.${urlProblem}`) : undefined}>
          <Input type="url" inputMode="url" dir="ltr" value={url} placeholder="https://" onChange={(event) => setUrl(event.currentTarget.value)} />
        </Field>
        <SubscriptionPicker value={subscription} onChange={setSubscription} />
        {problem === "events" && <p className="text-xs text-muted-foreground">{t("webhook.no_events")}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
    </Dialog>
  );
}
