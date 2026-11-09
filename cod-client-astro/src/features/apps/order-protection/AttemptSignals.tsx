import { useT } from "@/i18n/react";
import type { AttemptSignals } from "../../../../../cod-shared/order-screening/facts";

/** What is known about how an order was sent, in one line. Nothing when nothing is known. */
export function AttemptSignalsLine({ signals }: { signals: AttemptSignals }) {
  const t = useT("apps");
  const parts = [
    signals.appSource && t(`order_protection.options.app_source.${signals.appSource}`),
    signals.visitSource && t(`order_protection.options.visit_source.${signals.visitSource}`),
    signals.fillSeconds !== undefined && t("order_protection.signals.filled_in", { seconds: Math.round(signals.fillSeconds) }),
    signals.networkCountry,
    signals.networkOperator,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return <p className="text-xs text-muted-foreground"><bdi>{parts.join(" · ")}</bdi></p>;
}
