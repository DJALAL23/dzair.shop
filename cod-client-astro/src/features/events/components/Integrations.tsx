import { useEffect, useState } from "react";
import { AlertTriangle, Plug, Plus, Send, Webhook } from "lucide-react";
import { Button, Card, EmptyState, PageHeader, StatCard, StatGroup } from "@/components/ui";
import { useT } from "@/i18n/react";
import { listEventConsumers } from "@/features/events/api";
import { consumerStatus } from "@/features/events/model";
import { ApiKeyCard } from "@/features/events/components/ApiKeyCard";
import { ConsumerRow } from "@/features/events/components/ConsumerRow";
import { SigningSecretDialog } from "@/features/events/components/SigningSecretDialog";
import { WebhookDialog } from "@/features/events/components/WebhookDialog";
import type { EventConsumer, IssuedSecret } from "@/features/events/types";
import { WEBHOOK_CONSUMERS_MAX } from "../../../../../cod-shared/events/webhooks";

/**
 * The Integrations page: the merchant's own systems — their webhooks, how each
 * delivery went, and the store's API key (admins). A Built-in Consumer is on
 * its App's page, never here.
 */
export function Integrations({ canManage, showApiKey }: { canManage: boolean; showApiKey: boolean }) {
  const t = useT("events");
  const [webhooks, setWebhooks] = useState<EventConsumer[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [issued, setIssued] = useState<IssuedSecret | null>(null);
  const full = (webhooks?.length ?? 0) >= WEBHOOK_CONSUMERS_MAX;

  async function load() {
    try {
      setWebhooks((await listEventConsumers()).filter((consumer) => consumer.webhook !== null));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const addButton = canManage && (
    <Button disabled={full} title={full ? t("integrations.limit", { max: WEBHOOK_CONSUMERS_MAX }) : undefined} onClick={() => setAdding(true)}>
      <Plus size={15} aria-hidden="true" />
      {t("integrations.add_webhook")}
    </Button>
  );

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl bg-[var(--tone-magic-bg)] text-[var(--tone-magic-text)] shadow-[inset_0_0_0_1px_var(--tone-magic-border)]">
              <Webhook size={17} aria-hidden="true" />
            </span>
            <span>{t("integrations.title")}</span>
          </span>
        }
        subtitle={t("page.subtitle")}
        actions={webhooks && addButton}
      />
      {failed ? (
        <p role="alert" className="text-sm text-destructive">{t("integrations.load_error")}</p>
      ) : webhooks === null ? (
        <div role="status" aria-busy="true" className="space-y-6">
          <div className="h-20 shimmer rounded-xl" />
          <div className="h-48 shimmer rounded-xl" />
        </div>
      ) : (
        <div className="space-y-6">
          {webhooks.length > 0 && <WebhookFigures webhooks={webhooks} />}
          <Card title={t("page.webhooks_title")} subtitle={t("page.webhooks_subtitle")} flush>
            {webhooks.length === 0 ? (
              <EmptyState compact icon={<Webhook aria-hidden="true" />} title={t("page.webhooks_none")} description={t("page.empty_body")} action={addButton || undefined} />
            ) : (
              <ul className="divide-y divide-border border-t border-border">
                {webhooks.map((consumer) => (
                  <ConsumerRow key={consumer.id} consumer={consumer} canManage={canManage} onChanged={() => void load()} onIssued={setIssued} />
                ))}
              </ul>
            )}
            {full && <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">{t("integrations.limit", { max: WEBHOOK_CONSUMERS_MAX })}</p>}
          </Card>
          {showApiKey && <ApiKeyCard />}
        </div>
      )}
      {adding && (
        <WebhookDialog
          onClose={() => setAdding(false)}
          onSaved={({ signingSecret }) => {
            setAdding(false);
            setIssued({ signingSecret: signingSecret! });
            void load();
          }}
        />
      )}
      {issued && <SigningSecretDialog secret={issued} onClose={() => setIssued(null)} />}
    </>
  );
}

function WebhookFigures({ webhooks }: { webhooks: EventConsumer[] }) {
  const t = useT("events");
  const active = webhooks.filter((consumer) => consumerStatus(consumer) === "active").length;
  const due = webhooks.reduce((sum, consumer) => sum + consumer.deliveries.due, 0);
  const dead = webhooks.reduce((sum, consumer) => sum + consumer.deliveries.dead, 0);
  return (
    <StatGroup columns={3} compact>
      <StatCard label={t("page.figures.active")} value={<bdi dir="ltr">{`${active} / ${webhooks.length}`}</bdi>} icon={<Plug />} tone="success" />
      <StatCard label={t("page.figures.due")} value={due} icon={<Send />} tone="brand" />
      <StatCard label={t("page.figures.dead")} value={dead} icon={<AlertTriangle />} tone={dead > 0 ? "critical" : "neutral"} />
    </StatGroup>
  );
}
