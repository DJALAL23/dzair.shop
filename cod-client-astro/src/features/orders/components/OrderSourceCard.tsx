import { Bot, ChevronRight, CircleHelp, Code, Globe, Link2, Mail, Megaphone, MousePointerClick, Search, Share2, Signpost, Sparkles, UserRound, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { Card, Dialog } from "@/components/ui";
import { useT } from "@/i18n/react";
import type { Locale } from "@/i18n/config";
import { adFacts, beforeOrder, readablePlacement, referrerLabel, sourceHeadline, sourceJourney, storePage, visitFacts, type JourneyStep, type SourceFact, type SourceLabels } from "@/features/orders/model";
import type { OrderDetail, OrderListItem } from "@/features/orders/types";
import { AD_CREDIT_WINDOW_DAYS, SOURCE_LOOKBACK_DAYS, type OrderChannel } from "../../../../../cod-shared/attribution/model";

/** An order's source as a person reads it: "Instagram ad", "Direct visit". */
export function useSourceLabel() {
  const t = useT("orders");
  return (source: Parameters<typeof sourceHeadline>[0]): string | null => {
    const headline = sourceHeadline(source);
    if (!headline) return null;
    return t(`source.headline.${headline.key}`, headline.network ? { network: t(`source.network.${headline.network}`) } : undefined);
  };
}

const CHANNEL_ICONS: Record<OrderChannel, LucideIcon> = {
  paid_social: Megaphone,
  paid_search: Megaphone,
  paid_other: Megaphone,
  organic_social: Share2,
  organic_search: Search,
  ai_assistant: Sparkles,
  email: Mail,
  referral: Globe,
  tagged: Link2,
  direct: MousePointerClick,
  dashboard: UserRound,
  api: Code,
  agent: Bot,
};

/** The icon of a channel: a megaphone for an ad, a magnifier for a search engine… */
function ChannelIcon({ channel, size, className = "" }: { channel: OrderChannel | null | undefined; size: number; className?: string }) {
  const Icon = channel ? CHANNEL_ICONS[channel] : CircleHelp;
  return <Icon size={size} className={`shrink-0 text-muted-foreground ${className}`} aria-hidden="true" />;
}

/** The order's source in a list: its icon and headline, and the ad's name under it when it credits one. */
export function OrderSource({ order, compact = false, quiet = false }: { order: Pick<OrderListItem, "source">; compact?: boolean; quiet?: boolean }) {
  const t = useT("orders");
  const label = useSourceLabel();
  const headline = label(order.source ?? null) ?? t("source.unknown");
  const detail = order.source?.adName ?? order.source?.campaignName;
  return (
    <span className={`flex min-w-0 items-start gap-1.5 ${compact ? "text-xs" : "text-sm"}`}>
      <ChannelIcon channel={order.source?.channel} size={compact ? 12 : 14} className={compact ? "mt-px" : "mt-0.5"} />
      <span className="flex min-w-0 flex-col">
        <span className={`truncate ${order.source && !quiet ? "text-foreground" : "text-muted-foreground"}`}>{headline}</span>
        {detail && !compact && (
          <span className="truncate text-xs text-muted-foreground">
            <bdi>{detail}</bdi>
          </span>
        )}
      </span>
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

/** How the card words an Android app and a storefront page, in the dashboard's language. */
function useSourceLabels(): SourceLabels {
  const t = useT("orders");
  return {
    app: (app) => t("source.android_app", { app }),
    page: (page) => t(`source.page.${page.type}`, page.name === null ? undefined : { name: page.name }),
  };
}

type Attribution = NonNullable<OrderDetail["attribution"]>;

/** The visit or ad a journey step stands for. */
function stepData(step: JourneyStep, attribution: Attribution) {
  if (step.kind === "ad") return { ad: attribution.ad!, visit: null };
  const visit = step.kind === "first" ? attribution.first : step.kind === "earlier" ? attribution.earlier : attribution.visit;
  return { ad: null, visit: visit! };
}

/** A step's one-line detail: the ad and its placement, else where the visit came from or the page it landed on. */
function stepDetail(step: JourneyStep, attribution: Attribution, labels: SourceLabels): string | null {
  const { ad, visit } = stepData(step, attribution);
  if (ad) return [ad.adName ?? ad.campaignName ?? ad.campaignId ?? ad.utmCampaign, ad.placement ? readablePlacement(ad.placement) : null].filter(Boolean).join(" · ") || null;
  const page = storePage(visit.landingPath, visit.landingPageType);
  return referrerLabel(visit.referrerHost, labels.app) ?? visit.utmCampaign ?? (page ? labels.page(page) : null);
}

/** "1 minute before ordering": how long before the order a step happened. */
function useBeforeOrdering(orderedAt: string) {
  const t = useT("orders");
  return (at: string | null) => {
    if (!at) return null;
    const span = beforeOrder(at, orderedAt);
    return t(`source.${span.key}`, span.count === undefined ? undefined : { count: span.count });
  };
}

/** Why the credited step is the source, in one sentence. */
function useWhyCredited(orderedAt: string) {
  const t = useT("orders");
  const before = useBeforeOrdering(orderedAt);
  return (step: JourneyStep) => {
    if (step.kind === "ad") return step.ordered ? t("source.why_ad_same_visit") : t("source.why_ad", { when: before(step.at) ?? "" });
    if (step.kind === "earlier") return t("source.why_earlier", { when: before(step.at) ?? "" });
    return step.source.channel === "direct" ? t("source.why_direct") : t("source.why_visit");
  };
}

/**
 * Where the order came from, answer first: the source and why it gets the
 * credit, then every visit that led to the order in time order, then the
 * rule that decides, with the windows the code uses.
 */
function SourceDetails({ open, onClose, steps, attribution, orderedAt, locale, labels }: { open: boolean; onClose: () => void; steps: JourneyStep[]; attribution: Attribution; orderedAt: string; locale: Locale; labels: SourceLabels }) {
  const t = useT("orders");
  const label = useSourceLabel();
  const before = useBeforeOrdering(orderedAt);
  const why = useWhyCredited(orderedAt);
  const credited = steps.find((step) => step.credited) ?? steps[steps.length - 1]!;
  const factsOf = (step: JourneyStep) => {
    const { ad, visit } = stepData(step, attribution);
    return ad ? adFacts(ad, locale, labels) : visitFacts(visit, locale, labels);
  };
  const isDirect = (step: JourneyStep) => step.kind !== "ad" && step.source.channel === "direct";

  return (
    <Dialog open={open} onClose={onClose} placement="end" title={t("source.details_title")} icon={<Signpost size={17} aria-hidden="true" />}>
      <div className="space-y-6">
        <section aria-labelledby="source-answer" className="rounded-xl border border-primary/20 bg-primary/[0.04] p-4">
          <h3 id="source-answer" className="text-xs font-semibold text-muted-foreground">
            {t("source.title")}
          </h3>
          <p className="mt-1.5 flex items-center gap-2 text-base font-semibold">
            <ChannelIcon channel={credited.source.channel} size={17} />
            {label(credited.source)}
          </p>
          <p className="mt-1.5 text-sm text-muted-foreground">{why(credited)}</p>
          {isDirect(credited) && <p className="mt-1.5 text-xs text-muted-foreground">{t("source.direct_hint")}</p>}
          <div className="mt-4 border-t border-primary/10 pt-4">
            <Facts facts={factsOf(credited)} />
          </div>
        </section>

        {steps.length > 1 && (
          <section aria-labelledby="source-path">
            <h3 id="source-path" className="text-sm font-semibold">
              {t("source.journey")}
            </h3>
            <ol className="mt-3">
              {steps.map((step, index) => {
                const tags = [step.kind === "first" ? t("source.first_title") : null, step.ordered ? t("source.ordered") : null].filter(Boolean).join(" · ");
                return (
                  <li key={step.kind} className="relative ps-6 pb-5 last:pb-0">
                    {index < steps.length - 1 && <span className="absolute start-[4.5px] top-4 bottom-0 w-px bg-border" aria-hidden="true" />}
                    <span className={`absolute start-0 top-1.5 size-2.5 rounded-full ${step.credited ? "bg-primary" : "border border-muted-foreground/50 bg-card"}`} aria-hidden="true" />
                    <p className="flex flex-wrap items-center gap-2">
                      <span className={`text-sm ${step.credited ? "font-semibold" : "font-medium"}`}>{label(step.source)}</span>
                      {step.credited && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">{t("source.credited")}</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">{[tags, step.ordered ? null : before(step.at)].filter(Boolean).join(" · ")}</p>
                    {!step.credited && (
                      <>
                        {isDirect(step) && <p className="mt-1 text-xs text-muted-foreground">{t("source.direct_hint")}</p>}
                        <div className="mt-2">
                          <Facts facts={factsOf(step)} />
                        </div>
                      </>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        <section aria-labelledby="source-how" className="rounded-lg bg-muted/60 p-4">
          <h3 id="source-how" className="text-xs font-semibold">
            {t("source.how_title")}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">{t("source.how_intro")}</p>
          <ol className="mt-2 list-decimal space-y-1 ps-4 text-xs text-muted-foreground">
            <li>{t("source.how_ad", { count: AD_CREDIT_WINDOW_DAYS })}</li>
            <li>{t("source.how_visit")}</li>
            <li>{t("source.how_earlier", { count: SOURCE_LOOKBACK_DAYS })}</li>
            <li>{t("source.how_direct")}</li>
          </ol>
        </section>
      </div>
    </Dialog>
  );
}

/**
 * Where the order came from, read-only: the source in one line, the visits
 * that led to the order in time order with the credited one marked, and every
 * fact in a side panel. Nothing here is chosen by hand.
 */
export function OrderSourceCard({ order, locale }: { order: OrderDetail; locale: Locale }) {
  const t = useT("orders");
  const label = useSourceLabel();
  const labels = useSourceLabels();
  const ago = useBeforeOrdering(order.createdAt);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const attribution = order.attribution ?? null;
  const headline = attribution ? label(attribution) : null;

  if (!attribution || !headline) {
    return (
      <Card title={t("source.title")}>
        <div className="flex items-start gap-3">
          <ChannelIcon channel={null} size={18} className="mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-semibold">{t("source.unknown")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("source.unknown_hint")}</p>
          </div>
        </div>
      </Card>
    );
  }

  const steps = sourceJourney(attribution);
  const credited = steps.find((step) => step.credited) ?? null;
  const entered = attribution.method === "entered" || attribution.method === "merchant";
  const summary = [credited ? stepDetail(credited, attribution, labels) : null, credited && !credited.ordered ? ago(credited.at) : null].filter(Boolean).join(" · ");

  return (
    <Card title={t("source.title")}>
      <div className="flex items-start gap-3">
        <ChannelIcon channel={attribution.channel} size={18} className="mt-0.5" />
        <div className="min-w-0">
          <p className="text-base font-semibold">{headline}</p>
          {summary && (
            <p className="text-xs text-muted-foreground">
              <bdi>{summary}</bdi>
            </p>
          )}
          {entered && <p className="text-xs text-muted-foreground">{t("source.entered_note")}</p>}
        </div>
      </div>

      {steps.length > 1 && (
        <ol className="mt-4" aria-label={t("source.journey")}>
          {steps.map((step, index) => {
            const detail = stepDetail(step, attribution, labels);
            const tags = [step.kind === "first" ? t("source.first_title") : null, step.ordered ? t("source.ordered") : null].filter(Boolean).join(" · ");
            const when = step.ordered ? null : ago(step.at);
            return (
              <li key={step.kind} className="relative ps-6 pb-3 last:pb-0">
                {index < steps.length - 1 && <span className="absolute start-[4.5px] top-4 bottom-0 w-px bg-border" aria-hidden="true" />}
                <span
                  className={`absolute start-0 top-1.5 size-2.5 rounded-full ${step.credited ? "bg-primary" : "border border-muted-foreground/50 bg-card"}`}
                  aria-hidden="true"
                />
                <div className="flex items-baseline gap-3">
                  <span className="flex min-w-0 flex-1 items-baseline gap-2">
                    <span className={`truncate text-sm ${step.credited ? "font-semibold" : ""}`}>{label(step.source)}</span>
                    {step.credited && <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">{t("source.credited")}</span>}
                  </span>
                  {when && <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{when}</span>}
                </div>
                {(tags || detail || when) && (
                  <p className="truncate text-xs text-muted-foreground">
                    <bdi>{[tags, detail].filter(Boolean).join(" · ")}</bdi>
                    {when && <span className="sm:hidden">{tags || detail ? " · " : ""}{when}</span>}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {steps.length > 0 && (
        <>
          <button type="button" onClick={() => setDetailsOpen(true)} className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
            {t("source.details")}
            <ChevronRight size={14} className="rtl:rotate-180" aria-hidden="true" />
          </button>
          <SourceDetails open={detailsOpen} onClose={() => setDetailsOpen(false)} steps={steps} attribution={attribution} orderedAt={order.createdAt} locale={locale} labels={labels} />
        </>
      )}
    </Card>
  );
}
