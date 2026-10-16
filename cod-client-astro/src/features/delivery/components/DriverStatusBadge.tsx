import { Badge } from "@/components/ui";
import { useT } from "@/i18n/react";
import type { Driver } from "@/features/delivery/types";

export function DriverStatusBadge({ status }: { status: Driver["status"] }) {
  const t = useT("delivery");
  if (status === "available") return <Badge tone="success">{t("status.available")}</Badge>;
  if (status === "busy") return <Badge tone="warning">{t("status.busy")}</Badge>;
  return <Badge tone="neutral">{t("status.inactive")}</Badge>;
}
