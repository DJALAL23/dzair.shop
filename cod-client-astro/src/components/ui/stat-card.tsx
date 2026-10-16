import type { ReactNode } from "react";

export type StatCardTone =
  | "neutral"
  | "success"
  | "warning"
  | "critical"
  | "brand";

const tones: Record<StatCardTone, string> = {
  neutral: "text-muted-foreground",
  success: "text-[var(--tone-success-text)]",
  warning: "text-[var(--tone-warning-text)]",
  critical: "text-[var(--tone-critical-text)]",
  brand: "text-[var(--tone-magic-text)]",
};

/** One number the merchant watches: its name, the figure, and what it is made of. */
export function StatCard({
  label,
  value,
  icon,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  hint?: ReactNode;
  tone?: StatCardTone;
}) {
  return (
    <section className="min-w-0 rounded-xl bg-card p-4 shadow-card">
      <p className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
        {icon && (
          <span className={`shrink-0 [&_svg]:size-4 ${tones[tone]}`} aria-hidden="true">
            {icon}
          </span>
        )}
        <span className="truncate">{label}</span>
      </p>
      <p className="mt-2 text-2xl font-semibold leading-none tabular-nums text-foreground">
        {value}
      </p>
      {hint && <p className="mt-2 truncate text-xs text-muted-foreground">{hint}</p>}
    </section>
  );
}

const GROUP_COLUMNS: Record<number, string> = {
  1: "",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-4",
};

/** Stat cards joined into one strip, one column per card, like the numbers on Home. */
const COMPACT =
  "grid-cols-3 [&>section]:p-3 sm:[&>section]:p-4 [&_section>p:first-child]:text-xs sm:[&_section>p:first-child]:text-sm [&_section>p:nth-child(2)]:mt-1.5 [&_section>p:nth-child(2)]:text-lg sm:[&_section>p:nth-child(2)]:text-2xl";

export function StatGroup({ columns, compact = false, children, className = "" }: { columns: 1 | 2 | 3 | 4; compact?: boolean; children: ReactNode; className?: string }) {
  return (
    <div
      className={`grid gap-px overflow-hidden rounded-xl bg-border shadow-card [&>*]:min-w-0 [&>a>section]:h-full [&>a>section]:rounded-none [&>a>section]:shadow-none [&>section]:rounded-none [&>section]:shadow-none ${compact ? COMPACT : GROUP_COLUMNS[columns]} ${className}`}
    >
      {children}
    </div>
  );
}
