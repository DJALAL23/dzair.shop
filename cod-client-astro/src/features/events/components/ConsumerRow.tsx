import { useEffect, useState, type ReactNode } from "react";
import { BarChart2, MoreHorizontal, Webhook } from "lucide-react";
import { Badge, Button, Dialog, DropdownItem, DropdownMenu, DropdownSeparator, Switch, useConfirmDialog, type BadgeTone } from "@/components/ui";
import { useLocale, useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { relativeTime } from "@/lib/relative-time";
import { deleteWebhook, listConsumerDeliveries, retryEventDelivery, rotateSigningSecret, updateEventConsumer } from "@/features/events/api";
import { canRetry, consumerStatus, kindLabelKey, actionError, suggestedReplayRange, type ConsumerStatus } from "@/features/events/model";
import { DeliveryStateBadge } from "@/features/events/components/DeliveryStateBadge";
import { ReplayDialog } from "@/features/events/components/ReplayDialog";
import { TestEventDialog } from "@/features/events/components/TestEventDialog";
import { WebhookDialog } from "@/features/events/components/WebhookDialog";
import type { EventConsumer, EventDelivery, IssuedSecret } from "@/features/events/types";

const STATUS_TONES: Record<ConsumerStatus, BadgeTone> = { active: "success", failing: "warning", stopped_by_merchant: "neutral", stopped_failing: "critical", stopped_gone: "critical", stopped_bot_blocked: "critical", stopped_not_connected: "warning" };

function Tile({ native, children }: { native: boolean; children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className={`grid size-9 shrink-0 place-items-center rounded-xl [&_svg]:size-4 ${
        native ? "bg-[var(--tone-info-bg)] text-[var(--tone-info-text)]" : "bg-muted text-muted-foreground"
      }`}
    >
      {children}
    </span>
  );
}

/**
 * One Consumer, its status and its deliveries sheet: a webhook on the Integrations page,
 * a Built-in Consumer on its App's page. Steering it (start, stop, test, replay,
 * retry, edit, delete) is offered only to whoever may manage its owner.
 */
export function ConsumerRow({ consumer, canManage, onChanged, onIssued }: { consumer: EventConsumer; canManage: boolean; onChanged: () => void; onIssued?: (secret: IssuedSecret) => void }) {
  const t = useT("events");
  const locale = useLocale();
  const confirm = useConfirmDialog();
  const [busy, setBusy] = useState(false);
  const [showDeliveries, setShowDeliveries] = useState(false);
  const [editing, setEditing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [replayRange, setReplayRange] = useState<{ fromSequence: number; toSequence: number } | null | undefined>(undefined);
  const status = consumerStatus(consumer);
  const native = consumer.webhook === null;
  const kindKey = kindLabelKey(consumer.kind);
  const kindLabel = kindKey && t(kindKey) !== consumer.name ? t(kindKey) : null;
  const hasMenu = canManage && (!!consumer.webhook || consumer.enabled || !consumer.builtIn);

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
      onIssued?.(await rotateSigningSecret(consumer.id));
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
    <li className="px-4 py-4" data-consumer={consumer.id}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <Tile native={native}>{native ? <BarChart2 /> : <Webhook />}</Tile>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="truncate text-sm font-semibold text-foreground">{consumer.name}</p>
              <Badge tone={STATUS_TONES[status]} size="sm">
                {t(`status.${status}`, status === "failing" ? { since: relativeTime(consumer.failingSince!, locale) } : undefined)}
              </Badge>
              {consumer.deliveries.due > 0 && <Badge tone="info" size="sm">{t("counts.due", { count: consumer.deliveries.due })}</Badge>}
              {consumer.deliveries.dead > 0 && <Badge tone="critical" size="sm">{t("counts.dead", { count: consumer.deliveries.dead })}</Badge>}
            </div>
            {consumer.webhook ? (
              <>
                <p dir="ltr" title={consumer.webhook.url} className="mt-1 truncate text-start font-mono text-xs text-muted-foreground">{consumer.webhook.url}</p>
                <p className="mt-0.5 hidden text-xs text-muted-foreground sm:block">
                  {t("webhook.secret_label")} <bdi dir="ltr">{consumer.webhook.signingSecret}</bdi>
                  {consumer.webhook.previousSecretSignsUntil && Date.parse(consumer.webhook.previousSecretSignsUntil) > Date.now() && (
                    <> · {t("webhook.previous_until", { time: relativeTime(consumer.webhook.previousSecretSignsUntil, locale) })}</>
                  )}
                </p>
              </>
            ) : (
              kindLabel && <p className="mt-1 text-xs text-muted-foreground">{kindLabel}</p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 ps-12 sm:ps-0">
          <Button variant="outline" size="sm" aria-haspopup="dialog" onClick={() => setShowDeliveries(true)}>
            {t("actions.deliveries")}
          </Button>
          <Switch checked={consumer.enabled} disabled={busy || !canManage} onChange={() => void toggle()} aria-label={t("actions.switch", { name: consumer.name })} />
          {hasMenu && (
            <DropdownMenu trigger={<MoreHorizontal size={16} aria-hidden="true" />} triggerLabel={t("actions.more", { name: consumer.name })}>
              {consumer.webhook && <DropdownItem onClick={() => setTesting(true)}>{t("actions.test")}</DropdownItem>}
              {consumer.enabled && <DropdownItem onClick={() => void openReplay()}>{t("actions.replay")}</DropdownItem>}
              {!consumer.builtIn && (
                <>
                  <DropdownSeparator />
                  {consumer.webhook && (
                    <>
                      <DropdownItem onClick={() => setEditing(true)}>{t("actions.edit")}</DropdownItem>
                      <DropdownItem onClick={() => void rotate()}>{t("actions.rotate")}</DropdownItem>
                    </>
                  )}
                  <DropdownItem danger onClick={() => void remove()}>
                    {t("actions.delete")}
                  </DropdownItem>
                </>
              )}
            </DropdownMenu>
          )}
        </div>
      </div>
      {showDeliveries && (
        <Dialog
          placement="end"
          onClose={() => setShowDeliveries(false)}
          icon={native ? <BarChart2 size={16} aria-hidden="true" /> : <Webhook size={16} aria-hidden="true" />}
          title={t("deliveries.title", { name: consumer.name })}
          description={consumer.webhook ? <bdi dir="ltr" className="break-all font-mono text-xs">{consumer.webhook.url}</bdi> : undefined}
        >
          <DeliveriesList consumer={consumer} canManage={canManage} onChanged={onChanged} />
        </Dialog>
      )}
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

function DeliveriesList({ consumer, canManage, onChanged }: { consumer: EventConsumer; canManage: boolean; onChanged: () => void }) {
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
    <div className="mt-5">
      <div role="group" className="inline-flex gap-0.5 rounded-lg bg-muted p-0.5">
        <Button variant={onlyDead ? "ghost" : "secondary"} size="sm" aria-pressed={!onlyDead} onClick={() => setOnlyDead(false)}>{t("actions.all")}</Button>
        <Button variant={onlyDead ? "secondary" : "ghost"} size="sm" aria-pressed={onlyDead} onClick={() => setOnlyDead(true)}>{t("actions.only_dead")}</Button>
      </div>
      {failed ? (
        <p role="alert" className="mt-4 text-sm text-destructive">{t("integrations.load_error")}</p>
      ) : deliveries === null ? (
        <div role="status" aria-busy="true" className="mt-4 space-y-2">
          {[0, 1, 2, 3].map((item) => <div key={item} className="h-14 shimmer rounded-lg" />)}
        </div>
      ) : deliveries.length === 0 ? (
        <p className="mt-6 text-center text-sm text-muted-foreground">{t("deliveries.none")}</p>
      ) : (
        <ul className="mt-4 divide-y divide-border rounded-xl border border-border">
          {deliveries.map((delivery) => (
            <li key={delivery.id} className="px-3 py-3" data-delivery={delivery.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{t(`types.${delivery.event.type}`)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t("deliveries.event", { sequence: delivery.event.sequence })}
                    {" · "}
                    <time dateTime={delivery.event.occurredAt}>{relativeTime(delivery.event.occurredAt, locale)}</time>
                    {" · "}
                    {t("deliveries.attempts", { count: delivery.attempts })}
                  </p>
                </div>
                <DeliveryStateBadge state={delivery.state} />
              </div>
              {(delivery.lastError || (canManage && canRetry(delivery, consumer))) && (
                <div className="mt-2 flex items-center justify-between gap-3">
                  {delivery.lastError ? <p dir="ltr" className="min-w-0 truncate text-start font-mono text-xs text-[var(--tone-critical-text)]">{delivery.lastError}</p> : <span />}
                  {canManage && canRetry(delivery, consumer) && (
                    <Button variant="outline" size="sm" disabled={retrying === delivery.id} onClick={() => void retry(delivery)}>
                      {t("actions.retry")}
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {next !== null && (
        <Button variant="ghost" size="sm" className="mt-3 w-full" onClick={() => void load(next)}>
          {t("actions.load_more")}
        </Button>
      )}
    </div>
  );
}
