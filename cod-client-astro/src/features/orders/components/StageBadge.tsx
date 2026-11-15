import {
  AlertTriangle,
  Ban,
  CircleCheck,
  CircleX,
  Hourglass,
  MapPin,
  Package,
  PackageCheck,
  PackageOpen,
  PackagePlus,
  PackageX,
  PhoneMissed,
  Truck,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { useT } from "@/i18n/react";
import { stageClass, stageLabel } from "@/features/orders/model";
import type { OrderStage, OrderStatus } from "@/features/orders/types";

/** One icon per stage, so stages of the same colour still read apart: a missed call, a box being packed, a truck. */
export const STAGE_ICON: Record<OrderStage, LucideIcon> = {
  new: PackagePlus,
  unreachable: PhoneMissed,
  confirmed: CircleCheck,
  preparing: PackageOpen,
  ready_to_ship: Package,
  handoff_pending: Hourglass,
  in_transit: Truck,
  out_for_delivery: MapPin,
  delivered: PackageCheck,
  returning: Undo2,
  returned: PackageX,
  delivery_cancelled: Ban,
  cancelled: CircleX,
};

/** The stage's icon, or a warning when its delivery needs the merchant. */
export function StageIcon({ stage, needsAttention = false, size }: { stage: OrderStage; needsAttention?: boolean; size: number }) {
  const t = useT("orders");
  if (needsAttention) return <AlertTriangle size={size} role="img" aria-label={t("attention.label")} className="shrink-0" />;
  const Icon = STAGE_ICON[stage];
  return <Icon size={size} aria-hidden="true" className="shrink-0" />;
}

/** Where an order stands, as the merchant sees it — with a mark when its delivery needs them, and on no answer, which call it is at. */
export function StageBadge({ stage, needsAttention = false, calls = 0 }: { stage: OrderStage; needsAttention?: boolean; calls?: number }) {
  const t = useT("orders");
  return (
    <span className={`inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-md ps-1.5 pe-2 text-xs font-medium ${stageClass(stage)}`}>
      <StageIcon stage={stage} needsAttention={needsAttention} size={12} />
      {stageLabel(t, stage, calls)}
    </span>
  );
}

/** A move's icon: the icon of the stage it leads to. */
export function MoveIcon({ status, size }: { status: OrderStatus; size: number }) {
  const Icon = STAGE_ICON[status === "ready" ? "ready_to_ship" : status];
  return <Icon size={size} aria-hidden="true" className="shrink-0" />;
}
