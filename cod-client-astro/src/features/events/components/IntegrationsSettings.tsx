import { useEffect, useState } from "react";
import { Plug } from "lucide-react";
import { Badge, Button, Card, useConfirmDialog, type BadgeTone } from "@/components/ui";
import { useLocale, useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { relativeTime } from "@/lib/relative-time";
import { listConsumerDeliveries, listEventConsumers, retryEventDelivery, setEventConsumerEnabled } from "@/features/events/api";
import { canRetry, consumerStatus, kindLabelKey, redeliveryError, suggestedReplayRange, type ConsumerStatus } from "@/features/events/model";
import { DeliveryStateBadge } from "@/features/events/components/DeliveryStateBadge";
import { ReplayDialog } from "@/features/events/components/ReplayDialog";
import type { EventConsumer, EventDelivery } from "@/features/events/types";

const STATUS_TONES: Record<ConsumerStatus, BadgeTone> = { active: "success", failing: "warning", stopped_by_merchant: "neutral", stopped_failing: "critical", stopped_gone: "critical" };

/** Settings → Integrations: who receives the store's Business Events, and the merchant's word on them. */
export function IntegrationsSettings() {
  const t = useT("events");
  const [consumers, setConsumers] = useState<EventConsumer[] | null>(null);
  const [failed, setFailed] = useState(false);

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
    <Card title={t("integrations.title")} subtitle={t("integrations.subtitle")}>
      {failed ? (
        <p role="alert" className="text-sm text-destructive">{t("integrations.load_error")}</p>
      ) : consumers === null ? (
        <p role="status" aria-busy="true" className="h-16 animate-pulse rounded-md bg-muted" />
      ) : consumers.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("integrations.none")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {consumers.map((consumer) => (
            <ConsumerRow key={consumer.id} consumer={consumer} onChanged={() => void load()} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function ConsumerRow({ consumer, onChanged }: { consumer: EventConsumer; onChanged: () => void }) {
  const t = useT("events");
  const locale = useLocale();
  const confirm = useConfirmDialog();
  const [busy, setBusy] = useState(false);
  const [showDeliveries, setShowDeliveries] = useState(false);
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
      await setEventConsumerEnabled(consumer.id, !consumer.enabled);
      onChanged();
    } catch (cause) {
      notify.error(redeliveryError(cause, t));
    } finally {
      setBusy(false);
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
            <Plug size={15} aria-hidden="true" className="text-muted-foreground" />
            {consumer.name}
            {kindLabel && <span className="text-xs font-normal text-muted-foreground">{kindLabel}</span>}
          </p>
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
          <Button variant={consumer.enabled ? "dangerOutline" : "primary"} size="sm" disabled={busy} onClick={() => void toggle()}>
            {t(consumer.enabled ? "actions.stop" : "actions.start")}
          </Button>
        </div>
      </div>
      {showDeliveries && <DeliveriesList consumer={consumer} onChanged={onChanged} />}
      {replayRange !== undefined && <ReplayDialog consumer={consumer} initialRange={replayRange} onClose={() => setReplayRange(undefined)} onDone={onChanged} />}
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
      notify.error(redeliveryError(cause, t));
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
