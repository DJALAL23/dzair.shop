import { AlertTriangle } from "lucide-react";
import { useT } from "@/i18n/react";
import { stageClass } from "@/features/orders/model";
import type { OrderStage } from "@/features/orders/types";

type Progress = "waiting" | "moving" | "settled" | "stopped";

const PROGRESS: Record<OrderStage, Progress> = {
  new: "waiting",
  confirmed: "waiting",
  unreachable: "waiting",
  preparing: "waiting",
  ready_to_ship: "moving",
  handoff_pending: "moving",
  in_transit: "moving",
  out_for_delivery: "moving",
  returning: "moving",
  delivered: "settled",
  returned: "settled",
  delivery_cancelled: "stopped",
  cancelled: "stopped",
};

/** An empty ring while the order waits, half filled on its way, full once settled. */
function ProgressMark({ progress }: { progress: Progress }) {
  if (progress === "stopped") return null;
  return (
    <svg viewBox="0 0 12 12" className="size-3 shrink-0" aria-hidden="true">
      <circle cx="6" cy="6" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray={progress === "waiting" ? "2.2 1.5" : undefined} />
      {progress === "moving" && <path d="M6 2.5a3.5 3.5 0 0 1 0 7z" fill="currentColor" />}
      {progress === "settled" && <circle cx="6" cy="6" r="3.5" fill="currentColor" />}
    </svg>
  );
}

/** Where an order stands, as the merchant sees it — with a mark when its delivery needs them. */
export function StageBadge({ stage, needsAttention = false }: { stage: OrderStage; needsAttention?: boolean }) {
  const t = useT("orders");
  return (
    <span className={`inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-md ps-1.5 pe-2 text-xs font-medium ${stageClass(stage)}`}>
      {needsAttention ? (
        <AlertTriangle size={12} aria-label={t("attention.label")} className="shrink-0" />
      ) : (
        <ProgressMark progress={PROGRESS[stage]} />
      )}
      {t(`stage.${stage}`)}
    </span>
  );
}
