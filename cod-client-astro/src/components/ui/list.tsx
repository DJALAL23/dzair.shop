import type { ReactNode, SelectHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";
import { Select } from "./select";

/** The row above a list: its search first, then its filters, and how many records match at the end. */
export function ListToolbar({ children, count }: { children: ReactNode; count?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 p-2">
      {children}
      {count !== undefined && (
        <span className="ms-auto shrink-0 px-1 text-xs tabular-nums text-muted-foreground">{count}</span>
      )}
    </div>
  );
}

/** A filter as a quiet pill: dashed while it filters nothing, filled once it does. */
export function FilterPill({
  label,
  value,
  onChange,
  children,
  active,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  /** Whether the current value narrows the list; by default any value but "" and "all". */
  active?: boolean;
} & Pick<SelectHTMLAttributes<HTMLSelectElement>, "disabled">) {
  const on = active ?? (value !== "" && value !== "all");
  return (
    <Select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      variant="pill"
      wrapperClassName={`w-auto shrink-0 ${on ? "[&_button]:border-solid [&_button]:bg-foreground/[0.06]" : ""}`}
      triggerClassName="w-auto max-w-56"
    >
      {children}
    </Select>
  );
}

/** A row's own actions: always there on touch screens, shown on hover or focus with a mouse. */
export function RowActions({ children }: { children: ReactNode }) {
  return (
    <div
      onClick={(event) => event.stopPropagation()}
      className="flex items-center justify-end gap-0.5 transition-opacity duration-150 pointer-fine:opacity-0 pointer-fine:group-hover/row:opacity-100 pointer-fine:focus-within:opacity-100 [&:has([aria-expanded=true])]:opacity-100"
    >
      {children}
    </div>
  );
}

/** A list loading: rows in the list's own shape, so nothing jumps when it arrives. */
export function TableSkeleton({ rows = 8, columns = 5 }: { rows?: number; columns?: number }) {
  const widths = ["w-32", "w-24", "w-40", "w-16", "w-20", "w-14"];
  return (
    <div role="status" aria-busy="true" className="divide-y divide-border border-t border-border">
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} className="flex h-[52px] items-center gap-8 px-4">
          {Array.from({ length: columns }).map((__, column) => (
            <div
              key={column}
              className={`h-3 shimmer ${widths[column % widths.length]} ${column === columns - 1 ? "ms-auto" : ""} ${column > 1 && column < columns - 1 ? "hidden md:block" : ""}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export interface TabItem<K extends string> {
  key: K;
  label: ReactNode;
  count?: number;
  icon?: LucideIcon;
}

/** Views of one thing, side by side; the chosen one is filled. */
export function Tabs<K extends string>({
  items,
  value,
  onChange,
  label,
  className = "",
}: {
  items: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={`no-scrollbar flex items-center gap-0.5 overflow-x-auto ${className}`}>
      {items.map(({ key, label: text, count, icon: Icon }) => {
        const selected = key === value;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(key)}
            className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm transition-colors pointer-coarse:h-9 ${
              selected ? "bg-foreground/[0.08] font-semibold text-foreground" : "font-medium text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
            }`}
          >
            {Icon && <Icon size={14} aria-hidden="true" />}
            {text}
            {count !== undefined && <span className="text-xs font-medium tabular-nums text-muted-foreground">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export interface StatItem {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  href?: string;
  tone?: "neutral" | "critical" | "success" | "warning";
}

const STAT_TONE = {
  neutral: { label: "text-muted-foreground", value: "text-foreground" },
  critical: { label: "text-[var(--tone-critical-text)]", value: "text-[var(--tone-critical-text)]" },
  success: { label: "text-muted-foreground", value: "text-[var(--tone-success-text)]" },
  warning: { label: "text-[var(--tone-warning-text)]", value: "text-foreground" },
} as const;

/** The few numbers a page is about, in one strip; each can open what it counts. */
export function StatStrip({ items, className = "" }: { items: StatItem[]; className?: string }) {
  const columns = items.length >= 4 ? "lg:grid-cols-4" : items.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2";
  return (
    <div className={`grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-border shadow-card ${columns} ${className}`}>
      {items.map(({ label, value, hint, icon: Icon, href, tone = "neutral" }) => {
        const body = (
          <>
            <span className={`flex items-center gap-1.5 text-sm font-medium ${STAT_TONE[tone].label}`}>
              {Icon && <Icon size={14} aria-hidden="true" className="shrink-0" />}
              <span className="truncate">{label}</span>
            </span>
            <span className={`mt-2 truncate text-2xl font-semibold leading-none tabular-nums ${STAT_TONE[tone].value}`}>{value}</span>
            {hint && <span className="mt-2 line-clamp-2 text-xs text-muted-foreground">{hint}</span>}
          </>
        );
        const cell = "flex min-w-0 flex-col bg-card p-4";
        return href ? (
          <a key={label} href={href} className={`${cell} transition-colors hover:bg-subtle focus-visible:z-10`}>
            {body}
          </a>
        ) : (
          <div key={label} className={cell}>
            {body}
          </div>
        );
      })}
    </div>
  );
}
