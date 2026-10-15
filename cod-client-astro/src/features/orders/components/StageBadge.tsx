import { AlertTriangle } from "lucide-react";
import { useT } from "@/i18n/react";
import { stageClass } from "@/features/orders/model";
import type { OrderStage } from "@/features/orders/types";

/** Where an order stands, as the merchant sees it — with a mark when its delivery needs them. */
export function StageBadge({ stage, needsAttention = false }: { stage: OrderStage; needsAttention?: boolean }) {
  const t = useT("orders");
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-5 ${stageClass(stage)}`}
    >
      {needsAttention && <AlertTriangle size={11} aria-label={t("attention.label")} className="shrink-0" />}
      {t(`stage.${stage}`)}
    </span>
  );
}
