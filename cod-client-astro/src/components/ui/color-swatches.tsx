import { Check, Plus } from "lucide-react";

/** The label colours a merchant picks from, plus any colour of their own. */
export const LABEL_COLORS = ["#64748b", "#6366f1", "#8b5cf6", "#ec4899", "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#3b82f6"];

export function ColorSwatches({
  value,
  onChange,
  label,
  disabled = false,
}: {
  value: string;
  onChange: (color: string) => void;
  /** Names the group and the custom-colour picker for screen readers. */
  label: string;
  disabled?: boolean;
}) {
  const custom = !LABEL_COLORS.includes(value.toLowerCase());
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-2">
      {LABEL_COLORS.map((color) => {
        const selected = value.toLowerCase() === color;
        return (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={color}
            disabled={disabled}
            onClick={() => onChange(color)}
            className="grid size-8 place-items-center rounded-full transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card active:scale-90 disabled:opacity-50 pointer-coarse:size-10"
            style={{ backgroundColor: color }}
          >
            {selected && <Check size={14} strokeWidth={3} className="text-white" aria-hidden="true" />}
          </button>
        );
      })}
      <label
        className="relative grid size-8 cursor-pointer place-items-center overflow-hidden rounded-full text-muted-foreground shadow-card transition-colors hover:text-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring pointer-coarse:size-10"
        style={custom ? { backgroundColor: value, color: "#fff" } : undefined}
      >
        <input
          type="color"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.currentTarget.value)}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
          aria-label={label}
        />
        {custom ? <Check size={14} strokeWidth={3} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
      </label>
    </div>
  );
}
