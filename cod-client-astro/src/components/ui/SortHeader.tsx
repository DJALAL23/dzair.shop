import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { TableHead } from "./table";
import { InfoTip } from "./tooltip";

/**
 * Clickable, sort-aware table header. `sortKey` is generic so any list
 * domain (orders, drivers, offers, …) can reuse it — `onSort` receives it
 * back, and the active/direction props drive the icon + aria-sort state.
 */
export function SortHeader({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
  align = "start",
  help,
  wrap = false,
}: {
  label: string;
  sortKey: string;
  activeKey: string;
  direction: "asc" | "desc";
  onSort: (key: string) => void;
  align?: "start" | "end";
  /** What the column means, behind an ⓘ beside its label. */
  help?: ReactNode;
  /** A long label goes on two lines, so a table of many columns still fits. */
  wrap?: boolean;
}) {
  const isSorted = activeKey === sortKey;
  const Icon = !isSorted
    ? ArrowUpDown
    : direction === "asc"
      ? ArrowUp
      : ArrowDown;
  return (
    <TableHead
      aria-sort={
        isSorted
          ? direction === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
      numeric={align === "end"}
      wrap={wrap}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`group inline-flex min-h-7 items-center gap-1 text-xs font-medium transition-colors hover:text-foreground ${
          isSorted ? "text-foreground" : "text-muted-foreground"
        } ${align === "end" ? "flex-row-reverse" : ""}`}
      >
        <span className={wrap ? "max-w-24 text-balance" : undefined}>{label}</span>
        <Icon
          size={12}
          strokeWidth={2}
          className={`shrink-0 transition-all ${
            isSorted
              ? "text-brand opacity-100"
              : "opacity-0 group-hover:opacity-60 group-focus-visible:opacity-60"
          }`}
          aria-hidden="true"
        />
      </button>
      {help && (
        <span className="ms-1 inline-flex align-middle">
          <InfoTip>{help}</InfoTip>
        </span>
      )}
    </TableHead>
  );
}
