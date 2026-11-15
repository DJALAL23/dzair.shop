import { useState } from "react";
import { useTeamError } from "@/features/confirmation/errors";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { Badge, Button, Dialog, Field, Input, SwitchField } from "@/components/ui";
import { Choice } from "@/features/orders/components/HandoffDialog";
import { updateTeamSettings } from "@/features/confirmation/api";
import type { Distribution, TeamConfig } from "@/features/confirmation/types";

const DISTRIBUTIONS: Distribution[] = ["evenly", "in_turn", "manual"];
const MINUTES = { min: 5, max: 1440, default: 15 };
const LIMIT = { min: 1, max: 10 };

/**
 * How new orders reach the team: shared evenly (recommended), in turn, or
 * by hand; and whether an order a member leaves untouched moves on to the
 * next member, after how long and how often.
 */
export function TeamSettingsDialog({ config, onClose, onSaved }: { config: TeamConfig; onClose: () => void; onSaved: (config: TeamConfig) => void }) {
  const t = useT("confirmation");
  const explain = useTeamError();
  const [distribution, setDistribution] = useState<Distribution>(config.distribution);
  const [takeBack, setTakeBack] = useState(config.takeBackMinutes !== null);
  const [minutes, setMinutes] = useState(String(config.takeBackMinutes ?? MINUTES.default));
  const [limit, setLimit] = useState(String(config.takeBackLimit));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const minutesValue = Number(minutes);
  const limitValue = Number(limit);
  const minutesValid = Number.isInteger(minutesValue) && minutesValue >= MINUTES.min && minutesValue <= MINUTES.max;
  const limitValid = Number.isInteger(limitValue) && limitValue >= LIMIT.min && limitValue <= LIMIT.max;
  const valid = distribution === "manual" || !takeBack || (minutesValid && limitValid);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const auto = distribution !== "manual" && takeBack;
      const saved = await updateTeamSettings({ distribution, takeBackMinutes: auto ? minutesValue : null, takeBackLimit: auto ? limitValue : config.takeBackLimit });
      notify.success(t("settings.saved"));
      onSaved(saved);
      onClose();
    } catch (cause) {
      setError(explain(cause, "settings.save_error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={t("settings.title")}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("settings.cancel")}
          </Button>
          <Button type="button" disabled={!valid || busy} onClick={() => void save()}>
            {t("settings.save")}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-semibold text-foreground">{t("settings.distribution")}</legend>
          <div role="radiogroup" aria-label={t("settings.distribution")} className="space-y-1.5">
            {DISTRIBUTIONS.map((key) => (
              <Choice key={key} selected={distribution === key} onSelect={() => setDistribution(key)}>
                <span className="flex items-center gap-2">
                  <span className="font-semibold">{t(`settings.${key}_label`)}</span>
                  {key === "evenly" && (
                    <Badge tone="success" size="sm">
                      {t("settings.recommended")}
                    </Badge>
                  )}
                </span>
                <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{t(`settings.${key}_help`)}</span>
              </Choice>
            ))}
          </div>
        </fieldset>

        {distribution !== "manual" && (
          <div className="space-y-3 border-t border-border pt-4">
            <SwitchField label={t("settings.take_back")} help={t("settings.take_back_help")} checked={takeBack} onChange={setTakeBack} />
            {takeBack && (
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("settings.minutes")} error={minutesValid ? undefined : t("settings.minutes_range", { min: MINUTES.min, max: MINUTES.max })}>
                  <Input type="number" inputMode="numeric" min={MINUTES.min} max={MINUTES.max} value={minutes} onChange={(event) => setMinutes(event.currentTarget.value)} />
                </Field>
                <Field label={t("settings.limit")} hint={limitValid ? t("settings.limit_help") : undefined} error={limitValid ? undefined : t("settings.limit_range", { min: LIMIT.min, max: LIMIT.max })}>
                  <Input type="number" inputMode="numeric" min={LIMIT.min} max={LIMIT.max} value={limit} onChange={(event) => setLimit(event.currentTarget.value)} />
                </Field>
              </div>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm font-medium text-destructive">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
