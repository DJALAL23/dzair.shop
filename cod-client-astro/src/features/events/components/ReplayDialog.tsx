import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button, Dialog, Field, Input } from "@/components/ui";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { replayToEventConsumer } from "@/features/events/api";
import { redeliveryError, replayRangeProblem } from "@/features/events/model";
import type { EventConsumer } from "@/features/events/types";

/** Deliver a range of Business Events again to one Consumer. */
export function ReplayDialog({
  consumer,
  initialRange,
  onClose,
  onDone,
}: {
  consumer: EventConsumer;
  initialRange: { fromSequence: number; toSequence: number } | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT("events");
  const common = useT("common");
  const [from, setFrom] = useState(initialRange ? String(initialRange.fromSequence) : "");
  const [to, setTo] = useState(initialRange ? String(initialRange.toSequence) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = replayRangeProblem(Number(from || Number.NaN), Number(to || Number.NaN));

  async function submit() {
    if (problem) return;
    setBusy(true);
    setError(null);
    try {
      const done = await replayToEventConsumer(consumer.id, { fromSequence: Number(from), toSequence: Number(to) });
      notify.success(t("replay.done", { count: done.reopened + done.created }));
      onDone();
      onClose();
    } catch (cause) {
      setError(redeliveryError(cause, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      onClose={onClose}
      title={t("replay.title")}
      description={t("replay.body", { name: consumer.name })}
      icon={<RotateCcw size={18} />}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{common("cancel")}</Button>
          <Button onClick={() => void submit()} disabled={busy || problem !== null}>{t("replay.submit")}</Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("replay.from")}>
          <Input type="number" inputMode="numeric" min={1} dir="ltr" value={from} onChange={(event) => setFrom(event.currentTarget.value)} />
        </Field>
        <Field label={t("replay.to")}>
          <Input type="number" inputMode="numeric" min={1} dir="ltr" value={to} onChange={(event) => setTo(event.currentTarget.value)} />
        </Field>
      </div>
      {(from || to) && problem && <p className="mt-2 text-sm text-destructive">{t(`replay.${problem}`)}</p>}
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    </Dialog>
  );
}
