import { lazy, Suspense } from "react";
import { ErrorBoundary } from "@/components/ui";
import { useT } from "@/i18n/react";

const RichTextDescriptionEditor = lazy(() => import("./RichTextDescriptionEditor"));

interface RichTextFieldProps {
  value: string;
  onChange: (html: string) => void;
  busy?: boolean;
  disabled?: boolean;
}

/**
 * The rich-text editor, loaded on demand so it never joins the root bundle —
 * and never able to take the page down with it. While it loads, and if its
 * chunk fails to load (a deploy replaced it, the network dropped), the value
 * stays editable in a plain text box; a failure also says so and offers a
 * reload. Without the boundary, one failed import blanked the whole page.
 */
export function RichTextField({ value, onChange, busy, disabled }: RichTextFieldProps) {
  const common = useT("common");
  const plain = (
    <textarea
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      rows={6}
      disabled={busy || disabled}
      className="w-full rounded-md border border-border/60 bg-card p-3 text-sm"
    />
  );
  return (
    <ErrorBoundary
      fallback={
        <div className="space-y-1.5">
          <p role="alert" className="text-xs font-medium text-tone-warning-text">
            {common("editor_load_failed")}{" "}
            <button type="button" onClick={() => window.location.reload()} className="underline underline-offset-2">
              {common("reload_page")}
            </button>
          </p>
          {plain}
        </div>
      }
    >
      <Suspense fallback={plain}>
        <RichTextDescriptionEditor value={value} onChange={onChange} busy={busy} disabled={disabled} />
      </Suspense>
    </ErrorBoundary>
  );
}
