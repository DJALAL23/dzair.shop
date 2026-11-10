import type { ReactNode } from "react";
import { Ban, ShieldAlert } from "lucide-react";
import { Badge, Dialog, type BadgeTone } from "@/components/ui";
import { useLocale, useT } from "@/i18n/react";
import { relativeTime } from "@/lib/relative-time";
import { communeLabel, wilayaLabel } from "@/lib/places";
import { formatMoney } from "@/features/orders/model";
import type { OrderAttempt } from "@/features/apps/order-protection/api";
import { useAttemptSignals } from "@/features/apps/order-protection/AttemptSignals";
import { decidingFirst, listOf, useMatchName } from "@/features/apps/order-protection/words";
import type { OrderAttemptOutcome } from "../../../../../cod-shared/order-screening/signals";

export const OUTCOME_TONE: Record<OrderAttemptOutcome, BadgeTone> = { accepted: "neutral", flagged: "warning", spam: "critical", rescued: "info" };

/** "Alger · Baba Hassen": the wilaya, then the commune when it says more. */
export function attemptPlace(attempt: OrderAttempt, locale: Parameters<typeof wilayaLabel>[2]): string {
  const wilaya = wilayaLabel(attempt.wilayaId, null, locale);
  const commune = communeLabel(attempt.communeId, null, locale);
  return [wilaya, commune && commune !== wilaya ? commune : null].filter(Boolean).join(" · ");
}

/** Each product line as "Robe (Rouge) × 2". */
export function useAttemptLines(attempt: OrderAttempt): string[] {
  const t = useT("apps");
  return (attempt.lines ?? []).map((line) => t("order_protection.spam.line", { name: line.variantLabel ? `${line.name} (${line.variantLabel})` : line.name, quantity: line.quantity }));
}

/**
 * The rules that decided what happened to an attempt, and the others that
 * matched. Rules on Trial decided nothing; they are named only when asked for.
 */
export function useAttemptReasons(attempt: OrderAttempt, withTrials = false): { deciding: string[]; also: string[] } {
  const t = useT("apps");
  const matchName = useMatchName();
  const trials = withTrials ? attempt.matches.filter((match) => match.mode === "trial").map((match) => t("order_protection.activity.trial_match", { rule: matchName(match) })) : [];
  if (attempt.outcome === "spam" || attempt.outcome === "flagged") {
    const { deciding, also } = decidingFirst(attempt.matches, attempt.outcome === "spam" ? "spam" : "flag");
    return { deciding: deciding.map(matchName), also: [...also.map(matchName), ...trials] };
  }
  return { deciding: [], also: [...attempt.matches.filter((match) => match.mode === "active").map(matchName), ...trials] };
}

/** Who sent it: the name, with the phone under it and whether it is blocked. */
export function AttemptCustomer({ attempt, onOpen }: { attempt: OrderAttempt; onOpen?: () => void }) {
  const t = useT("apps");
  const name = attempt.customerName ?? t("order_protection.sheet.unknown_customer");
  return (
    <span className="flex min-w-0 flex-col">
      {onOpen ? (
        <button type="button" onClick={onOpen} className="truncate text-start font-medium text-foreground underline-offset-2 hover:underline">
          <bdi>{name}</bdi>
        </button>
      ) : (
        <span className="truncate font-medium text-foreground"><bdi>{name}</bdi></span>
      )}
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <span dir="ltr">{attempt.phone}</span>
        {attempt.phoneBlocked && (
          <span role="img" aria-label={t("order_protection.spam.number_blocked")} title={t("order_protection.spam.number_blocked")} className="inline-flex">
            <Ban size={12} aria-hidden="true" className="text-[var(--tone-critical-text)]" />
          </span>
        )}
      </span>
    </span>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="divide-y divide-border rounded-lg border border-border">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-start justify-between gap-4 px-3 py-2.5 text-sm">
          <dt className="shrink-0 text-muted-foreground">{label}</dt>
          <dd className="min-w-0 text-end text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * One order attempt in full, in a sheet beside its list: why it went where
 * it went, what was ordered, who sent it and how. The list keeps one line per
 * attempt; the actions on it come from the screen that opened it.
 */
export function AttemptSheet({ attempt, onClose, footer, withTrials = false }: { attempt: OrderAttempt; onClose: () => void; footer?: ReactNode; withTrials?: boolean }) {
  const t = useT("apps");
  const locale = useLocale();
  const lines = useAttemptLines(attempt);
  const signals = useAttemptSignals(attempt.signals);
  const { deciding, also } = useAttemptReasons(attempt, withTrials);
  const place = attemptPlace(attempt, locale);
  const spam = attempt.outcome === "spam";

  const order: [string, ReactNode][] = [];
  if (attempt.total !== null) order.push([t("order_protection.sheet.total"), <span className="font-medium tabular-nums">{formatMoney(attempt.total, locale)}</span>]);
  if (attempt.deliveryType) order.push([t("order_protection.sheet.delivery"), t(`order_protection.options.delivery_type.${attempt.deliveryType}`)]);

  const customer: [string, ReactNode][] = [
    [t("order_protection.sheet.phone"), (
      <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
        <span dir="ltr">{attempt.phone}</span>
        {attempt.phoneBlocked && <Badge tone="critical" size="sm">{t("order_protection.spam.number_blocked")}</Badge>}
      </span>
    )],
  ];
  if (place) customer.push([t("order_protection.sheet.place"), <bdi>{place}</bdi>]);
  if (attempt.ipBlocked) customer.push([t("order_protection.sheet.network"), <Badge tone="critical" size="sm">{t("order_protection.spam.network_blocked")}</Badge>]);

  return (
    <Dialog
      onClose={onClose}
      placement="end"
      icon={<ShieldAlert size={17} aria-hidden="true" />}
      title={<bdi>{attempt.customerName ?? t("order_protection.sheet.unknown_customer")}</bdi>}
      description={
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge tone={OUTCOME_TONE[attempt.outcome]} size="sm">{t(`order_protection.outcomes.${attempt.outcome}`)}</Badge>
          {attempt.orderNumber && <span>{attempt.orderNumber}</span>}
          <time dateTime={attempt.createdAt}>{relativeTime(attempt.createdAt, locale)}</time>
        </span>
      }
      footer={footer}
    >
      <div className="space-y-6">
        {(deciding.length > 0 || also.length > 0) && (
          <Section title={spam ? t("order_protection.sheet.why_spam") : t("order_protection.sheet.why")}>
            {deciding.length > 0 && (
              <p className={`rounded-lg px-3 py-2.5 text-sm font-medium ${spam ? "bg-[var(--tone-critical-bg)] text-[var(--tone-critical-text)]" : "bg-[var(--tone-warning-bg)] text-[var(--tone-warning-text)]"}`}>
                <bdi>{listOf(deciding, locale)}</bdi>
              </p>
            )}
            {also.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {deciding.length > 0 ? t("order_protection.spam.also", { rules: listOf(also, locale) }) : t("order_protection.activity.matched", { rules: listOf(also, locale) })}
              </p>
            )}
          </Section>
        )}

        {(lines.length > 0 || order.length > 0) && (
          <Section title={t("order_protection.sheet.order")}>
            {lines.length > 0 && (
              <ul className="space-y-1 text-sm text-foreground">
                {lines.map((line, index) => (
                  <li key={index}><bdi>{line}</bdi></li>
                ))}
              </ul>
            )}
            {order.length > 0 && <Facts rows={order} />}
          </Section>
        )}

        <Section title={t("order_protection.sheet.customer")}>
          <Facts rows={customer} />
        </Section>

        {signals.length > 0 && (
          <Section title={t("order_protection.sheet.sent")}>
            <ul className="flex flex-wrap gap-1.5">
              {signals.map((signal) => (
                <li key={signal}><Badge size="sm"><bdi>{signal}</bdi></Badge></li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </Dialog>
  );
}
