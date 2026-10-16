import type { ReactNode } from "react";
import { InfoTip } from "./tooltip";

export function Card({
  title,
  subtitle,
  help,
  action,
  children,
  className = "",
  flush = false,
}: {
  title?: string;
  subtitle?: string;
  /** The why behind this card, behind an ⓘ beside its title. */
  help?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
}) {
  const hasHeader = !!(title || subtitle || action);
  return (
    <section className={`rounded-xl bg-card shadow-card ${className}`}>
      {hasHeader && (
        <header
          className={`flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-4 pt-4 ${flush ? "pb-3" : ""}`}
        >
          <div className="min-w-0">
            {title && (
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-card-foreground">
                <span>{title}</span>
                {help && <InfoTip>{help}</InfoTip>}
              </h2>
            )}
            {subtitle && (
              <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          {action && <div className="-my-1 shrink-0">{action}</div>}
        </header>
      )}
      <div className={flush ? "" : hasHeader ? "px-4 pb-4 pt-3" : "p-4"}>{children}</div>
    </section>
  );
}
