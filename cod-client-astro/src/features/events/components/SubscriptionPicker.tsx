import { useId } from "react";
import { useT } from "@/i18n/react";
import { coveredByWider, pickPattern, SUBJECTS, typesOf } from "@/features/events/model";
import type { SubscriptionPattern } from "@/features/events/types";

/** The Event Types a webhook receives: every event, a whole subject, or types one by one. */
export function SubscriptionPicker({ value, onChange }: { value: SubscriptionPattern[]; onChange: (next: SubscriptionPattern[]) => void }) {
  const t = useT("events");
  const id = useId();

  const option = (pattern: SubscriptionPattern, label: string, strong = false) => {
    const covered = coveredByWider(value, pattern);
    return (
      <label className={`flex min-h-8 cursor-pointer items-center gap-2.5 rounded-md px-1 text-sm hover:bg-foreground/[0.04] ${covered ? "text-muted-foreground" : "text-foreground"} ${strong ? "font-medium" : ""}`}>
        <input
          type="checkbox"
          className="size-4 accent-[var(--primary)]"
          data-pattern={pattern}
          checked={covered || value.includes(pattern)}
          disabled={covered}
          onChange={(event) => onChange(pickPattern(value, pattern, event.currentTarget.checked))}
        />
        {label}
      </label>
    );
  };

  return (
    <fieldset aria-labelledby={`${id}-legend`} className="space-y-2">
      <legend id={`${id}-legend`} className="mb-1 text-sm font-medium text-foreground">
        {t("webhook.events")}
      </legend>
      {option("*", t("webhook.every_event"), true)}
      {SUBJECTS.map((subject) => (
        <div key={subject} className="rounded-lg border border-border p-2">
          {option(`${subject}.*`, t(`webhook.every_${subject}`), true)}
          <div className="ms-6 grid gap-x-3 sm:grid-cols-2">{typesOf(subject).map((type) => <div key={type}>{option(type, t(`types.${type}`))}</div>)}</div>
        </div>
      ))}
    </fieldset>
  );
}
