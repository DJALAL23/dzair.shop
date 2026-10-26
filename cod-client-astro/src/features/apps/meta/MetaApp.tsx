import { useEffect, useState } from "react";
import { Card } from "@/components/ui";
import { useT } from "@/i18n/react";
import { listEventConsumers } from "@/features/events/api";
import { ConsumerRow } from "@/features/events/components/ConsumerRow";
import type { EventConsumer } from "@/features/events/types";
import { MetaSetupSection } from "@/features/apps/meta/MetaSetupSection";
import type { AppBodyProps } from "@/features/apps/types";
import { consumerOwner } from "../../../../../cod-shared/apps/catalog";

/** The Meta App: its setup, then its conversions — the Built-in Consumer it keeps — and how each was delivered. */
export default function MetaApp({ canManage, onSaved }: AppBodyProps) {
  return (
    <div className="space-y-6">
      <MetaSetupSection canManage={canManage} onSaved={onSaved} />
      <MetaConversions canManage={canManage} onChanged={onSaved} />
    </div>
  );
}

function MetaConversions({ canManage, onChanged }: { canManage: boolean; onChanged: () => void }) {
  const t = useT("apps");
  const events = useT("events");
  const [consumers, setConsumers] = useState<EventConsumer[] | null>(null);
  const [failed, setFailed] = useState(false);

  async function load() {
    try {
      setConsumers((await listEventConsumers()).filter((consumer) => consumerOwner(consumer.kind) === "meta"));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <Card title={t("conversions.title")} subtitle={t("conversions.subtitle")} flush>
      {failed ? (
        <p role="alert" className="border-t border-border px-4 py-4 text-sm text-destructive">{events("integrations.load_error")}</p>
      ) : consumers === null ? (
        <div role="status" aria-busy="true" className="border-t border-border p-4">
          <div className="h-12 shimmer rounded-lg" />
        </div>
      ) : consumers.length === 0 ? (
        <p className="border-t border-border px-4 py-4 text-sm text-muted-foreground">{t("conversions.none")}</p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {consumers.map((consumer) => (
            <ConsumerRow
              key={consumer.id}
              consumer={consumer}
              canManage={canManage}
              onChanged={() => {
                void load();
                onChanged();
              }}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}
