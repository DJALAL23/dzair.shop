import type { ReactNode } from "react";

/** What an empty list says: what belongs here, and the one action that fills it. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex animate-rise flex-col items-center justify-center px-6 text-center ${
        compact ? "min-h-36 py-8" : "min-h-64 py-14"
      }`}
    >
      <span className="relative grid size-14 place-items-center text-muted-foreground [&_svg]:size-6">
        <span aria-hidden="true" className="absolute inset-0 rounded-full bg-muted" />
        <span aria-hidden="true" className="absolute -inset-2.5 rounded-full border border-dashed border-border" />
        <span className="relative">{icon}</span>
      </span>
      <h2 className="mt-5 text-base font-semibold text-foreground">{title}</h2>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
