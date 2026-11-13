import { Footprints, History, Megaphone, Sprout, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui";
import { useT } from "@/i18n/react";
import type { Locale } from "@/i18n/config";
import { adFacts, beforeOrder, sourceHeadline, visitFacts, type SourceFact, type SourceLabels } from "@/features/orders/model";
import type { OrderDetail, OrderListItem } from "@/features/orders/types";

/** An order's source as a person reads it: "Instagram ad", "Direct visit". */
export function useSourceLabel() {
  const t = useT("orders");
  return (source: Parameters<typeof sourceHeadline>[0]): string | null => {
    const headline = sourceHeadline(source);
    if (!headline) return null;
    return t(`source.headline.${headline.key}`, headline.network ? { network: t(`source.network.${headline.network}`) } : undefined);
  };
}

/** The order's source in a list: its headline, and the ad's name under it when it credits one. */
export function OrderSource({ order, compact = false }: { order: Pick<OrderListItem, "source">; compact?: boolean }) {
  const t = useT("orders");
  const label = useSourceLabel();
  const headline = label(order.source ?? null) ?? t("source.unknown");
  const detail = order.source?.adName ?? order.source?.campaignName;
  return (
    <span className={`flex min-w-0 flex-col ${compact ? "text-xs" : "text-sm"}`}>
      <span className={`truncate ${order.source ? "text-foreground" : "text-muted-foreground"}`}>{headline}</span>
      {detail && !compact && (
        <span className="truncate text-xs text-muted-foreground">
          <bdi>{detail}</bdi>
        </span>
      )}
    </span>
  );
}

function Facts({ facts }: { facts: SourceFact[] }) {
  const t = useT("orders");
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
      {facts.map((fact) => (
        <div key={fact.key} className="min-w-0">
          <dt className="text-xs font-semibold text-muted-foreground">{t(`source.fact.${fact.key}`)}</dt>
          <dd className="text-sm break-words">
            <bdi>{fact.value}</bdi>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Block({ icon, title, hint, children }: { icon: ReactNode; title: string; hint: string; children: ReactNode }) {
  return (
    <section className="space-y-2 border-t border-border pt-4">
      <div className="flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
      {children}
    </section>
  );
}

/** How the card words an Android app and a storefront page, in the dashboard's language. */
function useSourceLabels(): SourceLabels {
  const t = useT("orders");
  return {
    app: (app) => t("source.android_app", { app }),
    page: (page) => t(`source.page.${page.type}`, page.name === null ? undefined : { name: page.name }),
  };
}

/**
 * Where the order came from, read-only: the headline, then the ad it credits,
 * the earlier visit its source comes from when the shopper came back
 * directly, this visit and the first visit, kept apart. Nothing here is
 * chosen by hand.
 */
export function OrderSourceCard({ order, locale }: { order: OrderDetail; locale: Locale }) {
  const t = useT("orders");
  const label = useSourceLabel();
  const labels = useSourceLabels();
  const attribution = order.attribution ?? null;
  const headline = attribution ? label(attribution) : null;

  if (!headline) {
    return (
      <Card title={t("source.title")}>
        <p className="text-sm font-semibold">{t("source.unknown")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("source.unknown_hint")}</p>
      </Card>
    );
  }

  const { ad, visit, earlier, first } = attribution!;
  const sourceAt = ad?.clickedAt ?? earlier?.at ?? null;
  const before = sourceAt ? beforeOrder(sourceAt, order.createdAt) : null;
  const shownAt = new Set([ad?.clickedAt, earlier?.at, visit?.at].filter(Boolean));
  const firstApart = first && first.at && !shownAt.has(first.at) ? first : null;
  const ago = (at: string) => {
    const span = beforeOrder(at, order.createdAt);
    return t(`source.${span.key}`, span.count === undefined ? undefined : { count: span.count });
  };
  const entered = attribution!.method === "entered" || attribution!.method === "merchant";

  return (
    <Card title={t("source.title")}>
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          {entered ? <UserRound size={18} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" /> : <Megaphone size={18} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
          <div className="min-w-0">
            <p className="text-base font-semibold">{headline}</p>
            {before && <p className="text-xs text-muted-foreground">{t(`source.${before.key}`, before.count === undefined ? undefined : { count: before.count })}</p>}
            {entered && <p className="text-xs text-muted-foreground">{t("source.entered_note")}</p>}
          </div>
        </div>

        {ad && (
          <Block icon={<Megaphone size={15} className="text-muted-foreground" aria-hidden="true" />} title={t("source.ad_title")} hint={t("source.ad_hint")}>
            <Facts facts={adFacts(ad, locale, labels)} />
          </Block>
        )}

        {earlier && (
          <Block icon={<History size={15} className="text-muted-foreground" aria-hidden="true" />} title={t("source.earlier_title")} hint={t("source.earlier_hint")}>
            <p className="text-sm font-semibold">{label(earlier)}</p>
            <Facts facts={visitFacts(earlier, locale, labels)} />
          </Block>
        )}

        {visit && (
          <Block icon={<Footprints size={15} className="text-muted-foreground" aria-hidden="true" />} title={t("source.visit_title")} hint={t("source.visit_hint")}>
            <p className="text-sm font-semibold">{label(visit)}</p>
            {visit.channel === "direct" && <p className="text-xs text-muted-foreground">{t("source.direct_hint")}</p>}
            {ad && visit.at === ad.clickedAt ? <p className="text-xs text-muted-foreground">{t("source.same_visit")}</p> : <Facts facts={visitFacts(visit, locale, labels)} />}
          </Block>
        )}

        {firstApart && (
          <Block icon={<Sprout size={15} className="text-muted-foreground" aria-hidden="true" />} title={t("source.first_title")} hint={t("source.first_hint")}>
            <p className="text-sm font-semibold">
              {label(firstApart)} <span className="font-normal text-muted-foreground">· {ago(firstApart.at!)}</span>
            </p>
            <Facts facts={visitFacts({ ...firstApart, at: null }, locale, labels)} />
          </Block>
        )}

      </div>
    </Card>
  );
}
