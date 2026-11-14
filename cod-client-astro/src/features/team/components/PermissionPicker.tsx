import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { useT } from "@/i18n/react";
import { SCOPE_CATEGORIES } from "../../../../../cod-shared/rbac/scopes";
import { scopeLabel } from "@/features/team/model";

const CATEGORIES = Object.entries(SCOPE_CATEGORIES) as [string, { scopes: readonly string[] }][];

/** Every permission a member can be given, so a save never sends one the store does not define. */
export const KNOWN_SCOPES: readonly string[] = CATEGORIES.flatMap(([, category]) => category.scopes);

/**
 * Every permission, grouped by the part of the store it opens, each a card to
 * tick, and a group ticked at once. Given what the member has now, a card
 * that would change says whether it will be added or removed.
 */
export function PermissionPicker({
  selected,
  onChange,
  current,
  disabled = false,
}: {
  selected: readonly string[];
  onChange: (scopes: string[]) => void;
  current?: readonly string[];
  disabled?: boolean;
}) {
  const t = useT("team");
  const apps = useT("apps");
  const toggle = (scopes: readonly string[], on: boolean) =>
    onChange(on ? [...new Set([...selected, ...scopes])] : selected.filter((scope) => !scopes.includes(scope)));

  return (
    <div className="space-y-6">
      {CATEGORIES.map(([key, category]) => {
        const all = category.scopes.every((scope) => selected.includes(scope));
        return (
          <section key={key} aria-labelledby={`scopes-${key}`}>
            <div className="mb-3 flex items-center justify-between gap-3 border-b border-border pb-2">
              <h3 id={`scopes-${key}`} className="text-xs font-semibold text-muted-foreground">
                {t(`scope_categories.${key}`)}
              </h3>
              <button
                type="button"
                disabled={disabled}
                onClick={() => toggle(category.scopes, !all)}
                className="text-xs font-semibold text-foreground underline-offset-4 hover:underline disabled:opacity-50 pointer-coarse:py-1"
              >
                {all ? t("scope_dialog.clear_all") : t("scope_dialog.select_all")}
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {category.scopes.map((scope) => {
                const checked = selected.includes(scope);
                const changed = current !== undefined && checked !== current.includes(scope);
                return (
                  <label
                    key={scope}
                    className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-3 transition-colors ${
                      checked ? "border-primary/20 bg-primary/[0.03]" : "border-border bg-muted/20 hover:bg-muted/40"
                    } ${changed ? "ring-1 ring-primary/30" : ""}`}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => toggle([scope], event.currentTarget.checked)}
                        disabled={disabled}
                        className="size-4 shrink-0 accent-primary"
                      />
                      <span className="min-w-0">
                        <span className={`block truncate text-sm font-semibold ${checked ? "text-foreground" : "text-muted-foreground"}`}>
                          {scopeLabel(scope, t, apps)}
                        </span>
                        <span className="block truncate font-mono text-[11px] text-muted-foreground/50" dir="ltr">
                          {scope}
                        </span>
                      </span>
                    </span>
                    {changed && (
                      <span
                        className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold tracking-tight ${
                          checked ? "bg-tone-success-bg text-tone-success-text" : "bg-tone-critical-bg text-tone-critical-text"
                        }`}
                      >
                        {checked ? t("scope_dialog.will_grant") : t("scope_dialog.will_revoke")}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** A team dialog's title: its icon in the brand's tint, the title, and who it is about. */
export function TeamDialogTitle({ icon, title, about }: { icon: ReactNode; title: string; about?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">{icon}</span>
      <span className="min-w-0">
        {title}
        {about && <span className="ms-2 text-xs font-medium text-muted-foreground">{about}</span>}
      </span>
    </span>
  );
}

/** The footer every permissions dialog ends with, kept in view while the list scrolls: a reminder, and the dialog's buttons. */
export function PermissionDialogFooter({ children }: { children: ReactNode }) {
  const t = useT("team");
  return (
    <div className="sticky -bottom-4 -mx-4 -mb-4 mt-6 flex flex-col gap-3 border-t border-border bg-card px-4 py-3 sm:-bottom-5 sm:-mx-5 sm:-mb-5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Lock size={13} className="shrink-0" aria-hidden="true" />
        {t("scope_dialog.security_warning")}
      </p>
      <div className="flex gap-3">{children}</div>
    </div>
  );
}
