import { useEffect, useState } from "react";
import { Inbox, RotateCcw, Webhook } from "lucide-react";
import { Badge, Button, Select } from "@/components/ui";
import { useLocale, useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { relativeTime } from "@/lib/relative-time";
import { listCompanyWebhookEvents, retryWebhookEvent, type WebhookEventRow } from "@/features/delivery/api";
import { canRetryEvent } from "@/features/delivery/model";
import type { DeliveryCompany } from "@/features/delivery/types";
import { INBOX_RESULTS } from "../../../../../cod-shared/inbound/results";

const RESULT_TONE: Record<WebhookEventRow["result"], "success" | "neutral" | "warning" | "critical" | "info"> = {
  pending: "info",
  ok: "success",
  ignored: "neutral",
  unmatched: "warning",
  unknown_status: "warning",
  deferred_settlement: "neutral",
  error: "critical",
  dead: "critical",
  unmapped: "warning",
};

const PAGE_SIZE = 25;

/**
 * What the carrier pushed and what came of it: each event's outcome, the
 * order it moved, why it did not, and its tries. The ones that went wrong
 * can be processed again once what stopped them is fixed — a status mapped,
 * a parcel attached, the settings corrected.
 */
export function CompanyWebhookEventsCard({ company, canManage }: { company: DeliveryCompany | null; canManage: boolean }) {
  const t = useT("delivery_companies");
  const locale = useLocale();
  const [events, setEvents] = useState<WebhookEventRow[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<"" | WebhookEventRow["result"]>("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);

  async function load() {
    if (!company) return;
    setLoading(true);
    try {
      const page = await listCompanyWebhookEvents(company.id, { limit: PAGE_SIZE, ...(filter ? { result: filter } : {}) });
      setEvents(page.events);
      setTotal(page.total);
    } catch {
      notify.error(t("events_load_failed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [company?.id, filter]);

  async function loadMore() {
    if (!company) return;
    setLoadingMore(true);
    try {
      const page = await listCompanyWebhookEvents(company.id, { limit: PAGE_SIZE, offset: events.length, ...(filter ? { result: filter } : {}) });
      setEvents((prev) => [...prev, ...page.events]);
      setTotal(page.total);
    } catch {
      notify.error(t("events_load_failed"));
    } finally {
      setLoadingMore(false);
    }
  }

  async function retry(event: WebhookEventRow) {
    if (!company) return;
    setRetrying(event.id);
    try {
      const outcome = await retryWebhookEvent(company.id, event.id);
      if (outcome.result === "ok") notify.success(t("events_retry_ok"));
      else notify.error(t("events_retry_still", { result: t(`events_result_${outcome.result}`) }));
      await load();
    } catch (cause) {
      notify.error(cause instanceof Error ? cause.message : t("events_load_failed"));
    } finally {
      setRetrying(null);
    }
  }

  if (!company) return null;

  return (
    <div className="rounded-xl bg-card p-5 shadow-card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold text-muted-foreground/60">
          <Webhook size={14} className="text-primary/50" aria-hidden="true" />
          {t("events_title")}
        </h2>
        <div className="w-52">
          <Select value={filter} onChange={(event) => setFilter(event.currentTarget.value as "" | WebhookEventRow["result"])} aria-label={t("events_filter_label")}>
            <option value="">{t("events_filter_all")}</option>
            {INBOX_RESULTS.map((result) => (
              <option key={result} value={result}>
                {t(`events_result_${result}`)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {loading ? (
        <p role="status" className="py-8 text-center text-sm font-medium text-muted-foreground">
          {t("events_loading")}
        </p>
      ) : events.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <Inbox size={22} className="text-muted-foreground/40" aria-hidden="true" />
          <p className="text-sm font-semibold text-foreground">{filter ? t("events_empty_filtered") : t("events_empty")}</p>
          {!filter && <p className="max-w-sm text-xs font-medium leading-relaxed text-muted-foreground/70">{t("events_empty_hint")}</p>}
        </div>
      ) : (
        <>
          <ul className="divide-y divide-border">
            {events.map((event) => (
              <li key={event.id} className="flex items-start gap-3 py-3">
                <Badge tone={RESULT_TONE[event.result]} size="sm" className="mt-0.5 shrink-0">
                  {t(`events_result_${event.result}`)}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-semibold text-foreground">
                    {event.orderNumber && event.orderId ? (
                      <a href={`/orders/${encodeURIComponent(event.orderId)}`} className="text-link hover:underline">
                        {event.orderNumber}
                      </a>
                    ) : (
                      <span dir="ltr" className="font-mono text-xs text-muted-foreground">
                        {event.tracking ?? "—"}
                      </span>
                    )}
                    <span className="text-xs font-medium text-muted-foreground">{event.eventType}</span>
                  </p>
                  <p className="mt-0.5 text-xs font-medium text-muted-foreground/80">
                    {relativeTime(event.createdAt, locale)}
                    {event.reason ? ` · ${event.reason}` : ""}
                    {event.errorMsg ? ` · ${event.errorMsg}` : ""}
                  </p>
                  {event.attempts > 1 && (
                    <p className="mt-0.5 text-xs font-medium text-muted-foreground/70">
                      {t("events_tries", { count: event.attempts })}
                      {event.result === "error" && event.nextAttemptAt ? ` · ${t("events_next_try", { when: relativeTime(event.nextAttemptAt, locale) })}` : ""}
                    </p>
                  )}
                </div>
                {canManage && canRetryEvent(event.result) && (
                  <Button type="button" variant="secondary" size="sm" disabled={retrying !== null} onClick={() => void retry(event)}>
                    <RotateCcw size={13} />
                    {retrying === event.id ? t("events_retrying") : t("events_retry")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {events.length < total && (
            <Button type="button" variant="secondary" className="mt-4 w-full" onClick={() => void loadMore()} disabled={loadingMore}>
              {loadingMore ? t("events_loading") : t("events_load_more")}
            </Button>
          )}
          <p className="mt-2 text-center text-[11px] font-semibold text-muted-foreground/50">{`${events.length} / ${total}`}</p>
        </>
      )}
    </div>
  );
}
