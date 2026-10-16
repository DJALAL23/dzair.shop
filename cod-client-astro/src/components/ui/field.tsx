import type { ReactNode } from "react";
import { InfoTip } from "./tooltip";

export function Field({
  label,
  error,
  hint,
  help,
  children,
  className = "",
  as: Tag = "label",
}: {
  label: ReactNode;
  error?: string;
  /** Shown under the control: only what the merchant must see to fill it in. */
  hint?: ReactNode;
  /** The longer why and how, behind an ⓘ beside the label. */
  help?: ReactNode;
  children: ReactNode;
  className?: string;
  /**
   * `div` for children that are not one labelable control — a composite widget
   * such as the rich-text editor. A `label` forwards every click inside it to
   * its first labelable descendant, which for that editor is the toolbar's
   * first button (Undo), so typing then clicking the text would undo the edit.
   */
  as?: "label" | "div";
}) {
  return (
    <Tag className={`block space-y-1 ${className}`}>
      <span className="flex items-center gap-1.5 text-sm font-medium text-foreground select-none">
        {label}
        {help && <InfoTip>{help}</InfoTip>}
      </span>
      {children}
      {hint && (
        <span className="block text-xs text-muted-foreground">
          {hint}
        </span>
      )}
      {error && (
        <span
          className="block animate-fade text-xs font-medium text-destructive"
          role="alert"
        >
          {error}
        </span>
      )}
    </Tag>
  );
}
