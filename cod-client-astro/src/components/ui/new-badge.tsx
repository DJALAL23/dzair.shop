/** The small mark beside something the dashboard just gained. */
export function NewBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-[var(--tone-magic-bg)] px-2 text-[11px] font-semibold leading-none text-[var(--tone-magic-text)] shadow-[inset_0_0_0_1px_var(--tone-magic-border)]">
      {label}
    </span>
  );
}
