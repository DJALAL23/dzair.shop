import { useId, type ReactNode } from "react";
import { InfoTip } from "./tooltip";

/** An on/off control. Name it with `aria-label` or `aria-labelledby`. */
export function Switch({
  checked,
  onChange,
  disabled = false,
  ...aria
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      {...aria}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:h-6 pointer-coarse:w-11 ${
        checked ? "bg-primary" : "bg-foreground/15"
      }`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block size-4 rounded-full bg-white shadow-sm transition-transform duration-150 pointer-coarse:size-5 ${
          checked ? "translate-x-[18px] pointer-coarse:translate-x-[22px] rtl:-translate-x-[18px] rtl:pointer-coarse:-translate-x-[22px]" : "translate-x-0.5 rtl:-translate-x-0.5"
        }`}
      />
    </button>
  );
}

/** A setting that is on or off: its name, its ⓘ, and the switch. */
export function SwitchField({
  label,
  help,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  help?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground">
        <span id={id}>{label}</span>
        {help && <InfoTip>{help}</InfoTip>}
      </span>
      <Switch checked={checked} onChange={onChange} disabled={disabled} aria-labelledby={id} />
    </div>
  );
}
