import { useEffect, useState } from "react";
import { ChevronDown, Radio } from "lucide-react";
import { Badge, Card } from "@/components/ui";
import { useLocale, useT } from "@/i18n/react";
import { relativeTime } from "@/lib/relative-time";
import { listEventConsumers, listEventDeliveries, listOrderEvents } from "@/features/events/api";
import { eventByline } from "@/features/events/model";
import { DeliveryStateBadge } from "@/features/events/components/DeliveryStateBadge";
import type { BusinessEvent, EventConsumer, EventDelivery } from "@/features/events/types";

/**
 * What this order's integrations were told: its Business Events, oldest
 * first, each with who caused it and through what. For a merchant who manages
 * integrations, an event opens on who received it.
 */
export function OrderEventsCard({ orderId, canSeeDeliveries }: { orderId: string; canSeeDeliveries: boolean }) {
  const t = useT("events");
  const locale = useLocale();
  const [events, setEvents] = useState<BusinessEvent[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setEvents(null);
    setFailed(false);
    listOrderEvents(orderId).then(
      (loaded) => alive && setEvents(loaded),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [orderId]);

  return (
    <Card
      title={t("card.title")}
      subtitle={t("card.subtitle")}
      action={
        canSeeDeliveries && (
          <a href="/integrations" className="text-xs font-semibold text-foreground underline-offset-4 hover:underline">
            {t("card.manage")}
          </a>
        )
      }
    >
      {failed ? (
        <p role="alert" className="text-sm text-destructive">{t("card.load_error")}</p>
      ) : events === null ? (
        <p role="status" aria-busy="true" className="h-10 animate-pulse rounded-md bg-muted" />
      ) : events.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("card.none")}</p>
      ) : (
        <ol className="space-y-3">
          {events.map((event) => (
            <li key={event.id} className="flex items-start gap-3">
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                <Radio size={12} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t(`types.${event.type}`)}</p>
                <p className="text-xs text-muted-foreground">
                  <time dateTime={event.occurredAt}>{relativeTime(event.occurredAt, locale)}</time>
                  {" · "}
                  {eventByline(event, t)}
                </p>
                {canSeeDeliveries && (
                  <button
                    type="button"
                    aria-expanded={open === event.id}
                    onClick={() => setOpen(open === event.id ? null : event.id)}
                    className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary"
                  >
                    {t("card.deliveries")}
                    <ChevronDown size={12} aria-hidden="true" className={open === event.id ? "rotate-180" : ""} />
                  </button>
                )}
                {open === event.id && <EventDeliveries eventId={event.id} />}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function EventDeliveries({ eventId }: { eventId: string }) {
  const t = useT("events");
  const [rows, setRows] = useState<{ deliveries: EventDelivery[]; consumers: EventConsumer[] } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([listEventDeliveries(eventId), listEventConsumers()]).then(
      ([deliveries, consumers]) => alive && setRows({ deliveries, consumers }),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [eventId]);

  if (failed) return <p role="alert" className="mt-1 text-xs text-destructive">{t("card.load_error")}</p>;
  if (rows === null) return <p role="status" aria-busy="true" className="mt-1 h-5 animate-pulse rounded bg-muted" />;
  if (rows.deliveries.length === 0) return <p className="mt-1 text-xs text-muted-foreground">{t("card.no_deliveries")}</p>;
  const nameOf = (id: string) => rows.consumers.find((consumer) => consumer.id === id)?.name ?? id;
  return (
    <ul className="mt-1.5 space-y-1">
      {rows.deliveries.map((delivery) => (
        <li key={delivery.id} className="flex items-center gap-2 text-xs">
          <span className="truncate">{nameOf(delivery.consumerId)}</span>
          <DeliveryStateBadge state={delivery.state} />
          {delivery.lastError && <Badge tone="neutral" size="sm">{delivery.lastError}</Badge>}
        </li>
      ))}
    </ul>
  );
}
