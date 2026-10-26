import { Badge } from "@/components/ui";
import { useT } from "@/i18n/react";
import { STATUS_TONES } from "@/features/apps/model";
import { APP_REGISTRY } from "@/features/apps/registry";
import type { AppKey, AppStatus } from "@/features/apps/types";

export function AppTile({ appKey, size = "default" }: { appKey: AppKey; size?: "default" | "large" }) {
  const Icon = APP_REGISTRY[appKey].icon;
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-xl bg-[var(--tone-info-bg)] text-[var(--tone-info-text)] shadow-[inset_0_0_0_1px_var(--tone-info-border)] ${size === "large" ? "size-10" : "size-9"}`}
    >
      <Icon size={size === "large" ? 19 : 17} />
    </span>
  );
}

export function AppStatusBadge({ status }: { status: AppStatus }) {
  const t = useT("apps");
  return (
    <Badge tone={STATUS_TONES[status]} dot={status !== "not_set_up"}>
      {t(`status.${status}`)}
    </Badge>
  );
}
