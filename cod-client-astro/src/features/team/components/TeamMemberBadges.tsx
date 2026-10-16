import React from "react";
import {
  Boxes,
  Crown,
  Package,
  ShoppingBag,
  Star,
  Truck,
  UserCog,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui";
import { useT } from "@/i18n/react";
import type { ActivityLogMeta, TeamMember } from "@/features/team/types";

export const ENTITY_CONFIG: Record<
  string,
  { icon: React.ReactNode; color: string; bgColor: string }
> = {
  order: { icon: <Package size={14} />, color: "text-tone-info-text", bgColor: "bg-tone-info-bg border-tone-info-border" },
  customer: { icon: <Users size={14} />, color: "text-tone-magic-text", bgColor: "bg-tone-magic-bg border-tone-magic-border" },
  driver: { icon: <Truck size={14} />, color: "text-tone-success-text", bgColor: "bg-tone-success-bg border-tone-success-border" },
  product: { icon: <ShoppingBag size={14} />, color: "text-tone-attention-text", bgColor: "bg-tone-attention-bg border-tone-attention-border" },
  stock: { icon: <Boxes size={14} />, color: "text-tone-info-text", bgColor: "bg-tone-info-bg border-tone-info-border" },
  user: { icon: <UserCog size={14} />, color: "text-tone-critical-text", bgColor: "bg-tone-critical-bg border-tone-critical-border" },
  review: { icon: <Star size={14} />, color: "text-tone-warning-text", bgColor: "bg-tone-warning-bg border-tone-warning-border" },
};

export function entityConfig(entityType: string) {
  return ENTITY_CONFIG[entityType] ?? ENTITY_CONFIG.order;
}

export function StatusBadge({ status }: { status: TeamMember["status"] }) {
  const t = useT("team");
  return status === "active" ? (
    <Badge tone="success">{t("status.active")}</Badge>
  ) : (
    <Badge tone="neutral">{t("status.inactive")}</Badge>
  );
}

export function RoleBadge({ role }: { role: TeamMember["role"] }) {
  const common = useT("common");
  return role === "admin" ? (
    <Badge tone="warning">
      <Crown size={11} fill="currentColor" aria-hidden="true" />
      <span className="ms-1">{common("roles.admin")}</span>
    </Badge>
  ) : (
    <Badge tone="neutral">{common("roles.staff")}</Badge>
  );
}

export function MetadataHint({
  action,
  meta,
  locale,
}: {
  action: string;
  meta: ActivityLogMeta | null;
  locale: "ar" | "en" | "fr";
}) {
  const common = useT("common");
  if (!meta) return null;

  if (
    (action === "order.status_changed" ||
      action === "driver.status_changed" ||
      action === "product.status_changed") &&
    meta.status
  ) {
    const label = common(`statuses.${String(meta.status)}`);
    return (
      <span className="rounded-md bg-muted/60 px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
        {label.startsWith("common.statuses.") ? String(meta.status) : label}
      </span>
    );
  }
  if (action === "stock.adjusted" && meta.delta !== undefined) {
    const delta = Number(meta.delta);
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className={`text-[11px] font-semibold tabular-nums ${delta >= 0 ? "text-tone-success-text" : "text-tone-critical-text"}`}>
          {delta >= 0 ? "+" : ""}
          {new Intl.NumberFormat(locale === "ar" ? "ar-DZ" : "en-DZ").format(delta)}
        </span>
        {meta.stockType != null && (
          <span className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
            {String(meta.stockType)}
          </span>
        )}
        {meta.reason != null && (
          <span className="text-[11px] font-medium text-muted-foreground/60">
            · {String(meta.reason)}
          </span>
        )}
      </span>
    );
  }
  if (
    (action === "user.scope_granted" || action === "user.scope_revoked") &&
    meta.scope
  ) {
    return (
      <span className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
        {String(meta.scope)}
      </span>
    );
  }
  if (action === "user.role_changed" && meta.role) {
    const label = common(`roles.${String(meta.role)}`);
    return (
      <span className="rounded-md bg-tone-warning-bg px-1.5 py-0.5 text-[11px] font-semibold text-tone-warning-text">
        {label.startsWith("common.roles.") ? String(meta.role) : label}
      </span>
    );
  }
  if (
    (action === "review.approved" ||
      action === "review.rejected" ||
      action === "review.deleted") &&
    meta.rating
  ) {
    const rating = Number(meta.rating);
    return (
      <span className="inline-flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((step) => (
          <Star
            key={step}
            size={10}
            className={step <= rating ? "fill-tone-warning-text text-tone-warning-text" : "fill-none text-muted-foreground/30"}
          />
        ))}
      </span>
    );
  }
  return <span className="select-none text-sm text-muted-foreground/20">—</span>;
}
