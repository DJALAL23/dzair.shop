import { useEffect, useState } from "react";
import { MoreHorizontal, Plug, Plus, Webhook } from "lucide-react";
import { Badge, Button, Card, DropdownItem, DropdownMenu, DropdownSeparator, useConfirmDialog, type BadgeTone } from "@/components/ui";
import { useLocale, useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { relativeTime } from "@/lib/relative-time";
import { deleteWebhook, listConsumerDeliveries, listEventConsumers, retryEventDelivery, rotateSigningSecret, updateEventConsumer } from "@/features/events/api";
import { canRetry, consumerStatus, kindLabelKey, actionError, suggestedReplayRange, type ConsumerStatus } from "@/features/events/model";
import { DeliveryStateBadge } from "@/features/events/components/DeliveryStateBadge";
import { ReplayDialog } from "@/features/events/components/ReplayDialog";
import { SigningSecretDialog } from "@/features/events/components/SigningSecretDialog";
import { TestEventDialog } from "@/features/events/components/TestEventDialog";
import { WebhookDialog } from "@/features/events/components/WebhookDialog";
import type { EventConsumer, EventDelivery, IssuedSecret } from "@/features/events/types";
import { WEBHOOK_CONSUMERS_MAX } from "../../../../../cod-shared/events/webhooks";

const STATUS_TONES: Record<ConsumerStatus, BadgeTone> = { active: "success", failing: "warning", stopped_by_merchant: "neutral", stopped_failing: "critical", stopped_gone: "critical" };

/** Settings → Integrations: who receives the store's Business Events, and the merchant's word on them. */
export function IntegrationsSettings() {
  const t = useT("events");
  const [consumers, setConsumers] = useState<EventConsumer[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [issued, setIssued] = useState<IssuedSecret | null>(null);
  const webhooks = consumers?.filter((consumer) => consumer.webhook !== null).length ?? 0;
  const full = webhooks >= WEBHOOK_CONSUMERS_MAX;

  async function load() {
    try {
      setConsumers(await listEventConsumers());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <Card
      title={t("integrations.title")}
      subtitle={t("integrations.subtitle")}
      action={
        consumers && (
          <Button size="sm" disabled={full} title={full ? t("integrations.limit", { max: WEBHOOK_CONSUMERS_MAX }) : undefined} onClick={() => setAdding(true)}>
            <Plus size={14} aria-hidden="true" />
            {t("integrations.add_webhook")}
          </Button>
        )
      }
    >
      {full && <p className="mb-3 text-xs text-muted-foreground">{t("integrations.limit", { max: WEBHOOK_CONSUMERS_MAX })}</p>}
      {failed ? (
        <p role="alert" className="text-sm text-destructive">{t("integrations.load_error")}</p>
      ) : consumers === null ? (
        <p role="status" aria-busy="true" className="h-16 animate-pulse rounded-md bg-muted" />
      ) : consumers.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("integrations.none")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {consumers.map((consumer) => (
            <ConsumerRow key={consumer.id} consumer={consumer} onChanged={() => void load()} onIssued={setIssued} />
          ))}
        </ul>
      )}
      {adding && (
        <WebhookDialog
          onClose={() => setAdding(false)}
          onSaved={({ signingSecret }) => {
            setAdding(false);
            setIssued({ signingSecret: signingSecret! });
            void load();
          }}
        />
      )}
      {issued && <SigningSecretDialog secret={issued} onClose={() => setIssued(null)} />}
    </Card>
  );
}

function ConsumerRow({ consumer, onChanged, onIssued }: { consumer: EventConsumer; onChanged: () => void; onIssued: (secret: IssuedSecret) => void }) {
  const t = useT("events");
  const locale = useLocale();
  const confirm = useConfirmDialog();
  const [busy, setBusy] = useState(false);
  const [showDeliveries, setShowDeliveries] = useState(false);
  const [editing, setEditing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [replayRange, setReplayRange] = useState<{ fromSequence: number; toSequence: number } | null | undefined>(undefined);
  const status = consumerStatus(consumer);
  const kindKey = kindLabelKey(consumer.kind);
  const kindLabel = kindKey && t(kindKey) !== consumer.name ? t(kindKey) : null;

  async function toggle() {
    if (consumer.enabled) {
      const sure = await confirm({ title: t("stop_confirm.title", { name: consumer.name }), description: t("stop_confirm.body"), confirmLabel: t("stop_confirm.confirm"), tone: "danger" });
      if (!sure) return;
    }
    setBusy(true);
    try {
      await updateEventConsumer(consumer.id, { enabled: !consumer.enabled });
      onChanged();
    } catch (cause) {
      notify.error(actionError(cause, t));
    } finally {
      setBusy(false);
    }
  }

  async function rotate() {
    const sure = await confirm({ title: t("rotate_confirm.title", { name: consumer.name }), description: t("rotate_confirm.body"), confirmLabel: t("rotate_confirm.confirm") });
    if (!sure) return;
    try {
      onIssued(await rotateSigningSecret(consumer.id));
      onChanged();
    } catch (cause) {
      notify.error(actionError(cause, t));
    }
  }

  async function remove() {
    const sure = await confirm({ title: t("delete_confirm.title", { name: consumer.name }), description: t("delete_confirm.body"), confirmLabel: t("delete_confirm.confirm"), tone: "danger" });
    if (!sure) return;
    try {
      await deleteWebhook(consumer.id);
      notify.success(t("webhook.deleted"));
      onChanged();
    } catch (cause) {
      notify.error(actionError(cause, t));
    }
  }

  async function openReplay() {
    try {
      const { deliveries } = await listConsumerDeliveries(consumer.id, { limit: 100 });
      setReplayRange(suggestedReplayRange(deliveries));
    } catch {
      setReplayRange(null);
    }
  }

  return (
    <li className="py-4 first:pt-0 last:pb-0" data-consumer={consumer.id}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold">
            {consumer.webhook ? <Webhook size={15} aria-hidden="true" className="text-muted-foreground" /> : <Plug size={15} aria-hidden="true" className="text-muted-foreground" />}
            {consumer.name}
            {kindLabel && <span className="text-xs font-normal text-muted-foreground">{kindLabel}</span>}
          </p>
          {consumer.webhook && (
            <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              <p dir="ltr" className="break-all text-start font-mono">{consumer.webhook.url}</p>
              <p>
                {t("webhook.secret_label")} <bdi dir="ltr">{consumer.webhook.signingSecret}</bdi>
                {consumer.webhook.previousSecretSignsUntil && Date.parse(consumer.webhook.previousSecretSignsUntil) > Date.now() && (
                  <> · {t("webhook.previous_until", { time: relativeTime(consumer.webhook.previousSecretSignsUntil, locale) })}</>
                )}
              </p>
            </div>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge tone={STATUS_TONES[status]} size="sm">
              {t(`status.${status}`, status === "failing" ? { since: relativeTime(consumer.failingSince!, locale) } : undefined)}
            </Badge>
            {consumer.deliveries.due > 0 && <Badge tone="info" size="sm">{t("counts.due", { count: consumer.deliveries.due })}</Badge>}
            {consumer.deliveries.dead > 0 && <Badge tone="critical" size="sm">{t("counts.dead", { count: consumer.deliveries.dead })}</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" aria-expanded={showDeliveries} onClick={() => setShowDeliveries(!showDeliveries)}>
            {t(showDeliveries ? "actions.hide_deliveries" : "actions.deliveries")}
          </Button>
          {consumer.enabled && (
            <Button variant="outline" size="sm" onClick={() => void openReplay()}>
              {t("actions.replay")}
            </Button>
          )}
          {consumer.webhook && (
            <Button variant="outline" size="sm" onClick={() => setTesting(true)}>
              {t("actions.test")}
            </Button>
          )}
          <Button variant={consumer.enabled ? "dangerOutline" : "primary"} size="sm" disabled={busy} onClick={() => void toggle()}>
            {t(consumer.enabled ? "actions.stop" : "actions.start")}
          </Button>
          {!consumer.builtIn && (
            <DropdownMenu trigger={<MoreHorizontal size={16} aria-hidden="true" />} triggerLabel={t("actions.more", { name: consumer.name })}>
              {consumer.webhook && (
                <>
                  <DropdownItem onClick={() => setEditing(true)}>{t("actions.edit")}</DropdownItem>
                  <DropdownItem onClick={() => void rotate()}>{t("actions.rotate")}</DropdownItem>
                  <DropdownSeparator />
                </>
              )}
              <DropdownItem danger onClick={() => void remove()}>
                {t("actions.delete")}
              </DropdownItem>
            </DropdownMenu>
          )}
        </div>
      </div>
      {showDeliveries && <DeliveriesList consumer={consumer} onChanged={onChanged} />}
      {replayRange !== undefined && <ReplayDialog consumer={consumer} initialRange={replayRange} onClose={() => setReplayRange(undefined)} onDone={onChanged} />}
      {testing && <TestEventDialog consumer={consumer} onClose={() => setTesting(false)} />}
      {editing && (
        <WebhookDialog
          consumer={consumer}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            notify.success(t("webhook.saved"));
            onChanged();
          }}
        />
      )}
    </li>
  );
}

function DeliveriesList({ consumer, onChanged }: { consumer: EventConsumer; onChanged: () => void }) {
  const t = useT("events");
  const locale = useLocale();
  const [onlyDead, setOnlyDead] = useState(consumer.deliveries.dead > 0);
  const [deliveries, setDeliveries] = useState<EventDelivery[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);

  async function load(before?: number) {
    try {
      const page = await listConsumerDeliveries(consumer.id, { ...(onlyDead ? { state: "dead" as const } : {}), ...(before === undefined ? {} : { before }) });
      setDeliveries((shown) => (before === undefined ? page.deliveries : [...(shown ?? []), ...page.deliveries]));
      setNext(page.next);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }

  useEffect(() => {
    setDeliveries(null);
    void load();
  }, [onlyDead, consumer.id]);

  async function retry(delivery: EventDelivery) {
    setRetrying(delivery.id);
    try {
      await retryEventDelivery(delivery.id);
      notify.success(t("retry.done"));
      await load();
      onChanged();
    } catch (cause) {
      notify.error(actionError(cause, t));
    } finally {
      setRetrying(null);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-border p-3">
      <div className="mb-2 flex gap-1.5" role="group">
        <Button variant={onlyDead ? "ghost" : "secondary"} size="sm" aria-pressed={!onlyDead} onClick={() => setOnlyDead(false)}>{t("actions.all")}</Button>
        <Button variant={onlyDead ? "secondary" : "ghost"} size="sm" aria-pressed={onlyDead} onClick={() => setOnlyDead(true)}>{t("actions.only_dead")}</Button>
      </div>
      {failed ? (
        <p role="alert" className="text-sm text-destructive">{t("integrations.load_error")}</p>
      ) : deliveries === null ? (
        <p role="status" aria-busy="true" className="h-10 animate-pulse rounded-md bg-muted" />
      ) : deliveries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("deliveries.none")}</p>
      ) : (
        <ul className="space-y-2">
          {deliveries.map((delivery) => (
            <li key={delivery.id} className="flex flex-wrap items-center justify-between gap-2 text-sm" data-delivery={delivery.id}>
              <div className="min-w-0">
                <p className="font-medium">
                  {t(`types.${delivery.event.type}`)} <span className="text-xs font-normal text-muted-foreground">{t("deliveries.event", { sequence: delivery.event.sequence })}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  <time dateTime={delivery.event.occurredAt}>{relativeTime(delivery.event.occurredAt, locale)}</time>
                  {" · "}
                  {t("deliveries.attempts", { count: delivery.attempts })}
                  {delivery.lastError && <span dir="ltr"> · {delivery.lastError}</span>}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <DeliveryStateBadge state={delivery.state} />
                {canRetry(delivery, consumer) && (
                  <Button variant="ghost" size="sm" disabled={retrying === delivery.id} onClick={() => void retry(delivery)}>
                    {t("actions.retry")}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {next !== null && (
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => void load(next)}>
          {t("actions.load_more")}
        </Button>
      )}
    </div>
  );
}
