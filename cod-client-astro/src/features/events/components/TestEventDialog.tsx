import { useState } from "react";
import { Send } from "lucide-react";
import { Badge, Button, Dialog, Field, Select } from "@/components/ui";
import { useT } from "@/i18n/react";
import { sendTestEvent } from "@/features/events/api";
import { actionError, coveredByWider, typesOf, SUBJECTS } from "@/features/events/model";
import type { EventConsumer, EventType, WebhookTest } from "@/features/events/types";

/** Send an example event to a webhook now, and show what its endpoint did with it. */
export function TestEventDialog({ consumer, onClose }: { consumer: EventConsumer; onClose: () => void }) {
  const t = useT("events");
  const common = useT("common");
  const types = SUBJECTS.flatMap(typesOf);
  const received = types.filter((type) => consumer.subscription.includes(type) || coveredByWider(consumer.subscription, type));
  const [type, setType] = useState<EventType>(received[0] ?? types[0]!);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<WebhookTest | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await sendTestEvent(consumer.id, type));
    } catch (cause) {
      setError(actionError(cause, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      onClose={onClose}
      title={t("test.title")}
      description={t("test.body")}
      icon={<Send size={18} />}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{common("close")}</Button>
          <Button onClick={() => void send()} disabled={busy}>{t("test.send")}</Button>
        </>
      }
    >
      <p dir="ltr" className="mb-3 break-all text-start font-mono text-xs text-muted-foreground">{consumer.webhook!.url}</p>
      <Field label={t("test.type")}>
        <Select value={type} onChange={(event) => setType(event.currentTarget.value as EventType)}>
          {types.map((option) => (
            <option key={option} value={option}>
              {t(`types.${option}`)}
            </option>
          ))}
        </Select>
      </Field>
      {result && (
        <div className="mt-4 space-y-2" data-test-result={result.outcome}>
          <p className="flex items-start gap-2 text-sm">
            <Badge tone={result.outcome === "delivered" ? "success" : "critical"} size="sm">
              {result.httpStatus ?? "—"}
            </Badge>
            <span role="status">
              {result.outcome === "delivered" ? (
                t("test.delivered", { status: result.httpStatus!, ms: result.durationMs })
              ) : (
                <>
                  {t("test.failed")} <bdi dir="ltr">{result.error}</bdi>
                </>
              )}
            </span>
          </p>
          {result.response && (
            <div>
              <p className="text-xs font-medium text-muted-foreground">{t("test.answer")}</p>
              <pre dir="ltr" className="mt-1 max-h-40 overflow-auto rounded-md bg-muted p-2 text-xs whitespace-pre-wrap break-all">{result.response}</pre>
            </div>
          )}
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    </Dialog>
  );
}
