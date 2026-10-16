import { Badge } from "@/components/ui";
import { useT } from "@/i18n/react";
import type { OfferStatus } from "@/features/offers/types";

export function OfferStatusBadge({ status }: { status: OfferStatus }) {
  const t = useT("offers");
  return status === "active" ? (
    <Badge tone="success">{t("status.active")}</Badge>
  ) : (
    <Badge tone="neutral">{t("status.inactive")}</Badge>
  );
}
