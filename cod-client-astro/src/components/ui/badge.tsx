import type { ReactNode } from "react";

export type BadgeTone =
  | "neutral"
  | "success"
  | "warning"
  | "attention"
  | "critical"
  | "info"
  | "brand";

export type BadgeSize = "default" | "sm";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-[var(--tone-neutral-bg)] text-[var(--tone-neutral-text)]",
  success: "bg-[var(--tone-success-bg)] text-[var(--tone-success-text)]",
  warning: "bg-[var(--tone-warning-bg)] text-[var(--tone-warning-text)]",
  attention: "bg-[var(--tone-attention-bg)] text-[var(--tone-attention-text)]",
  critical: "bg-[var(--tone-critical-bg)] text-[var(--tone-critical-text)]",
  info: "bg-[var(--tone-info-bg)] text-[var(--tone-info-text)]",
  brand: "bg-[var(--tone-magic-bg)] text-[var(--tone-magic-text)]",
};

const sizes: Record<BadgeSize, string> = {
  default: "h-5 px-2 text-xs",
  sm: "h-[18px] px-1.5 text-[11px]",
};

export function Badge({
  children,
  tone = "neutral",
  size = "default",
  dot = false,
  className = "",
}: {
  children: ReactNode;
  tone?: BadgeTone;
  size?: BadgeSize;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md font-medium leading-none select-none ${tones[tone]} ${sizes[size]} ${className}`}
    >
      {dot && (
        <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
      )}
      {children}
    </span>
  );
}
