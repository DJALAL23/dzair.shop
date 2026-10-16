import { useId } from "react";
import { useT } from "@/i18n/react";
import { Badge, InfoTip } from "@/components/ui";

/**
 * Which moment counts as a conversion.
 *
 * Chosen in two places now — the store's Settings → Tracking, and a single
 * landing page's own tracking — so the four options, their copy and the
 * "recommended" mark live here rather than in two drifting copies. A merchant
 * comparing a page's choice against the store's has to be reading the same
 * four cards or the comparison is meaningless.
 *
 * The strings stay in the `settings` namespace: they describe Meta events, not
 * a particular screen.
 */
export type ConversionEvent =
  | "Purchase"
  | "Purchase_Confirmed"
  | "Purchase_Delivered"
  | "Lead";

interface EventOptionMeta {
  value: ConversionEvent;
  titleKey: string;
  stageKey: string;
  hintKey: string;
  timingKey: string;
  tagKey: string;
  isRecommended?: boolean;
}

export const CONVERSION_EVENT_OPTIONS: EventOptionMeta[] = [
  {
    value: "Purchase",
    titleKey: "store.tracking_event_purchase_instant_title",
    stageKey: "store.tracking_event_purchase_instant_stage",
    hintKey: "store.tracking_event_purchase_instant_hint",
    timingKey: "store.tracking_event_purchase_instant_timing",
    tagKey: "store.tracking_event_purchase_instant_tag",
    isRecommended: true,
  },
  {
    value: "Purchase_Confirmed",
    titleKey: "store.tracking_event_purchase_confirmed_title",
    stageKey: "store.tracking_event_purchase_confirmed_stage",
    hintKey: "store.tracking_event_purchase_confirmed_hint",
    timingKey: "store.tracking_event_purchase_confirmed_timing",
    tagKey: "store.tracking_event_purchase_confirmed_tag",
  },
  {
    value: "Purchase_Delivered",
    titleKey: "store.tracking_event_purchase_delivered_title",
    stageKey: "store.tracking_event_purchase_delivered_stage",
    hintKey: "store.tracking_event_purchase_delivered_hint",
    timingKey: "store.tracking_event_purchase_delivered_timing",
    tagKey: "store.tracking_event_purchase_delivered_tag",
  },
  {
    value: "Lead",
    titleKey: "store.tracking_event_lead_title",
    stageKey: "store.tracking_event_lead_stage",
    hintKey: "store.tracking_event_lead_hint",
    timingKey: "store.tracking_event_lead_timing",
    tagKey: "store.tracking_event_lead_tag",
  },
];

/** The human name of a conversion event, for summaries and badges. */
export function useConversionEventLabel() {
  const t = useT("settings");
  return (value: ConversionEvent) => {
    const option = CONVERSION_EVENT_OPTIONS.find((candidate) => candidate.value === value);
    return option ? t(option.titleKey) : value;
  };
}

export function ConversionEventPicker({
  value,
  onChange,
  disabled = false,
  compact = false,
}: {
  /** null until the merchant chooses — never defaulted for them. */
  value: ConversionEvent | null;
  onChange: (value: ConversionEvent) => void;
  disabled?: boolean;
  /** One column and no timing, for the narrower dialog. */
  compact?: boolean;
}) {
  const t = useT("settings");
  const name = useId();

  return (
    <div className={`grid gap-2 ${compact ? "" : "sm:grid-cols-2"}`} role="radiogroup" aria-label={t("store.tracking_event_label")}>
      {CONVERSION_EVENT_OPTIONS.map((option) => {
        const isSelected = value === option.value;
        return (
          <label
            key={option.value}
            className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${
              isSelected ? "border-primary bg-subtle" : "border-border hover:bg-subtle"
            }`}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={isSelected}
              disabled={disabled}
              onChange={() => onChange(option.value)}
              className="shrink-0 accent-[var(--primary)] focus-visible:outline-none"
            />
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-medium text-foreground">{t(option.titleKey)}</span>
              {option.isRecommended && <Badge tone="info">{t("store.tracking_event_recommended")}</Badge>}
            </span>
            {!compact && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{t(option.timingKey)}</span>}
            <InfoTip>
              <span className="block font-medium">{t(option.stageKey)}</span>
              <span className="mt-1 block">{t(option.hintKey)}</span>
              <span className="mt-1 block opacity-80">{t(option.tagKey)}</span>
            </InfoTip>
          </label>
        );
      })}
    </div>
  );
}
