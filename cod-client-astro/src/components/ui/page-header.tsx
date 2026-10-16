import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

export function PageHeader({
  title,
  subtitle,
  backHref,
  backLabel,
  actions,
  badges,
  media,
  className = "",
}: {
  title: ReactNode;
  /** Status marks shown beside the title. */
  badges?: ReactNode;
  /** A small picture of the record: its image or initial. */
  media?: ReactNode;
  subtitle?: ReactNode;
  backHref?: string;
  backLabel?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={`mb-6 flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-border pb-4 ${className}`}
    >
      <div className="flex min-w-0 items-center gap-2">
        {backHref && (
          <a
            href={backHref}
            aria-label={backLabel}
            className="-ms-1.5 grid size-8 shrink-0 place-items-center rounded-lg text-foreground/80 transition-colors hover:bg-foreground/[0.06] hover:text-foreground pointer-coarse:size-10"
          >
            <ArrowLeft
              size={16}
              className="rtl:rotate-180"
              aria-hidden="true"
            />
          </a>
        )}
        {media && <div className="me-1 shrink-0">{media}</div>}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h1 className="text-xl font-semibold text-foreground">{title}</h1>
            {badges}
          </div>
          {subtitle && (
            <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {actions}
        </div>
      )}
    </header>
  );
}
