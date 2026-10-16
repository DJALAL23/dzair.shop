import { Lock, type LucideIcon } from "lucide-react";
import { Badge, InfoTip } from "@/components/ui";
import type { FieldState } from "@/features/checkout-form/types";

/**
 * One row of the form editor: what the field is, how strictly it is asked for,
 * and — behind an ⓘ — why it matters.
 *
 * A segmented control rather than a switch, because the useful answer is rarely
 * yes/no — "optional" is the state most merchants actually want, and a toggle
 * cannot say it.
 *
 * Locked rows keep the same shape but read as platform-owned: a lock and a
 * badge where the control would be. A merchant should be able to see that name
 * and phone were considered and held back, not forgotten.
 */
export function FieldStateControl({
  icon: Icon,
  label,
  hint,
  value,
  states,
  onChange,
  stateLabel,
  locked = false,
  lockedNote,
}: {
  icon: LucideIcon;
  label: string;
  hint?: string;
  value?: FieldState;
  states?: readonly FieldState[];
  onChange?: (state: FieldState) => void;
  stateLabel: (state: FieldState) => string;
  locked?: boolean;
  lockedNote?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <span className="flex min-w-0 items-center gap-2.5">
        <Icon size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate text-sm font-medium text-foreground">{label}</span>
        {hint && <InfoTip>{hint}</InfoTip>}
      </span>

      {locked || !states || !value ? (
        <Badge tone="neutral" className="shrink-0 gap-1">
          <Lock size={10} aria-hidden="true" />
          {lockedNote}
        </Badge>
      ) : (
        <div role="radiogroup" aria-label={label} className="flex shrink-0 rounded-lg bg-muted p-0.5">
          {states.map((state) => {
            const active = state === value;
            return (
              <button
                key={state}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onChange?.(state)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:py-2 ${
                  active ? "bg-card text-foreground shadow-card" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {stateLabel(state)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
