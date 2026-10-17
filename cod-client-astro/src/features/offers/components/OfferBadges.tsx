import { Badge } from "@/components/ui";
import { useT } from "@/i18n/react";
import { OFFER_STATE_TONE } from "@/features/offers/model";
import type { OfferState } from "@/features/offers/types";

export function OfferStateBadge({ state }: { state: OfferState }) {
  const t = useT("offers");
  return <Badge tone={OFFER_STATE_TONE[state]}>{t(`state.${state}`)}</Badge>;
}
