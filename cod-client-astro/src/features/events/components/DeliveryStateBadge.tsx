import { Badge, type BadgeTone } from "@/components/ui";
import { useT } from "@/i18n/react";
import type { DeliveryState } from "@/features/events/types";

const TONES: Record<DeliveryState, BadgeTone> = { due: "info", delivered: "success", skipped: "neutral", dead: "critical" };

export function DeliveryStateBadge({ state }: { state: DeliveryState }) {
  const t = useT("events");
  return (
    <Badge tone={TONES[state]} size="sm">
      {t(`states.${state}`)}
    </Badge>
  );
}
