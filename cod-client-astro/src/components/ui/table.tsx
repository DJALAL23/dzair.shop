import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";

export function Table({
  className = "",
  ...props
}: HTMLAttributes<HTMLTableElement>) {
  return (
    <table
      {...props}
      className={`w-full caption-bottom text-start text-sm ${className}`}
    />
  );
}

export function TableHeader({
  className = "",
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      {...props}
      className={`border-y border-border bg-subtle text-xs font-medium text-muted-foreground select-none ${className}`}
    />
  );
}

export function TableBody({
  className = "",
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody
      {...props}
      className={`divide-y divide-border ${className}`}
    />
  );
}

export function TableRow({
  className = "",
  ...props
}: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      {...props}
      className={`group/row transition-colors duration-100 hover:bg-subtle ${className}`}
    />
  );
}

// Tailwind has no class merging here — when a caller passes an explicit
// text-align utility it must replace the start default, not race it in the
// stylesheet (that race misaligned headers vs cells on every table).
const HAS_EXPLICIT_ALIGN = /\btext-(start|end|center|left|right)\b/;

export function TableHead({
  className = "",
  numeric = false,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  const align = numeric ? "text-end" : HAS_EXPLICIT_ALIGN.test(className) ? "" : "text-start";
  return (
    <th
      scope="col"
      {...props}
      className={`h-10 px-3 first:ps-4 last:pe-4 ${align} whitespace-nowrap font-medium align-middle ${className}`}
    />
  );
}

/** One fact per cell, on a 52px row. `numeric` right-aligns money and counts on tabular figures. */
export function TableCell({
  className = "",
  numeric = false,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      {...props}
      className={`h-13 px-3 py-2 first:ps-4 last:pe-4 align-middle text-foreground ${numeric ? "text-end tabular-nums whitespace-nowrap" : ""} ${className}`}
    />
  );
}

/** A cell with nothing to say: one quiet dash. */
export function CellEmpty() {
  return <span className="text-subtle-foreground" aria-hidden="true">—</span>;
}

/** The fact a merchant scans a row for — a name or a number — with an optional thumbnail or initial before it. */
export function RowTitle({
  href,
  media,
  children,
}: {
  href?: string;
  media?: ReactNode;
  children: ReactNode;
}) {
  const text = href ? (
    <a href={href} className="truncate font-medium text-foreground underline-offset-2 hover:underline">
      {children}
    </a>
  ) : (
    <span className="truncate font-medium text-foreground">{children}</span>
  );
  return (
    <span className="flex min-w-0 items-center gap-3">
      {media}
      {text}
    </span>
  );
}

/** A round initial standing in for a person or company without a picture. */
export function Initial({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`grid size-7 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground ${className}`}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

const INTERACTIVE = "a, button, input, select, textarea, label, [role='menu'], [role='dialog']";

/** Lets a whole row open its record, while the row's own links and controls keep their click. */
export function openRowOnClick(href: string) {
  return (event: { target: EventTarget; currentTarget: EventTarget; metaKey: boolean; ctrlKey: boolean }) => {
    if (!(event.target instanceof Node) || !(event.currentTarget instanceof Node)) return;
    if (!event.currentTarget.contains(event.target)) return;
    if (event.target instanceof Element && event.target.closest(INTERACTIVE)) return;
    if (window.getSelection()?.toString()) return;
    if (event.metaKey || event.ctrlKey) window.open(href, "_blank", "noopener");
    else window.location.assign(href);
  };
}
