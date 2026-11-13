import type { ReactNode } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { useT } from "@/i18n/react";

export type AlertTone = "info" | "critical" | "warning" | "success";

const tones: Record<
  AlertTone,
  { container: string; icon: typeof Info }
> = {
  info: {
    container:
      "border-[var(--tone-info-border)] bg-[var(--tone-info-bg)] text-[var(--tone-info-text)]",
    icon: Info,
  },
  critical: {
    container:
      "border-[var(--tone-critical-border)] bg-[var(--tone-critical-bg)] text-[var(--tone-critical-text)]",
    icon: AlertCircle,
  },
  warning: {
    container:
      "border-[var(--tone-warning-border)] bg-[var(--tone-warning-bg)] text-[var(--tone-warning-text)]",
    icon: AlertTriangle,
  },
  success: {
    container:
      "border-[var(--tone-success-border)] bg-[var(--tone-success-bg)] text-[var(--tone-success-text)]",
    icon: CheckCircle2,
  },
};

export function Alert({
  children,
  tone = "info",
  role,
  className = "",
  onDismiss,
}: {
  children: ReactNode;
  tone?: AlertTone;
  role?: "alert" | "status";
  className?: string;
  /** Shows a close button that calls it. */
  onDismiss?: () => void;
}) {
  const common = useT("common");
  const config = tones[tone];
  const Icon = config.icon;
  return (
    <div
      role={role}
      className={`flex animate-rise items-start gap-2.5 rounded-xl border p-3 text-sm ${config.container} ${className}`}
    >
      <Icon
        size={16}
        className="mt-0.5 shrink-0"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1 leading-relaxed">{children}</div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label={common("close")} className="-m-1 shrink-0 rounded-md p-1 opacity-70 transition-opacity hover:opacity-100">
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
