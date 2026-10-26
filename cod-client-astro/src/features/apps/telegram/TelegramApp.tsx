import { useEffect, useRef, useState } from "react";
import { Bell, Bot, ExternalLink, MessageCircle, Send } from "lucide-react";
import { Alert, Button, Card, Input, Select, SwitchField } from "@/components/ui";
import { useLocale, useT } from "@/i18n/react";
import { ApiError } from "@/lib/api";
import { relativeTime } from "@/lib/relative-time";
import { listEventConsumers } from "@/features/events/api";
import { ConsumerRow } from "@/features/events/components/ConsumerRow";
import { SUBJECTS, typesOf } from "@/features/events/model";
import type { EventConsumer } from "@/features/events/types";
import { FieldRow, SettingsSection } from "@/features/settings/components/SettingsSection";
import type { AppBodyProps } from "@/features/apps/types";
import { changeTelegramApp, getTelegramApp, openTelegramPairing, saveTelegramBot, sendTelegramTest } from "@/features/apps/telegram/api";
import { connectedSince, telegramAttentionKey, telegramErrorKey } from "@/features/apps/telegram/model";
import type { TelegramApp as TelegramAppView, TelegramPairing, TelegramTest } from "@/features/apps/telegram/types";
import { STORE_LOCALES, STORE_LOCALE_INFO, type StoreLocale } from "../../../../../cod-shared/i18n/locales";
import type { EventType } from "../../../../../cod-shared/events/catalogue";

const POLL_MS = 3000;

/** The Telegram App: the merchant's own bot telling their team what happens in the store. */
export default function TelegramApp({ canManage, onSaved }: AppBodyProps) {
  const t = useT("apps");
  const [app, setApp] = useState<TelegramAppView | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  async function load() {
    try {
      setApp(await getTelegramApp());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function changed(next: TelegramAppView) {
    setApp(next);
    onSaved();
  }

  if (failed) return <Alert role="alert" tone="critical">{t("telegram.errors.load")}</Alert>;
  if (app === undefined) return <div role="status" aria-busy="true" className="h-40 shimmer rounded-xl" />;

  const attention = app ? telegramAttentionKey(app) : null;
  return (
    <div className="space-y-6">
      {attention && <Alert tone="warning">{t(attention)}</Alert>}
      <BotSection app={app} canManage={canManage} onChanged={changed} />
      {app?.bot && <ChatSection app={app} canManage={canManage} onChanged={changed} reload={load} />}
      {app?.bot && <NotificationsSection app={app} canManage={canManage} onChanged={changed} />}
      {app && <TelegramDeliveries consumerId={app.consumerId} canManage={canManage} onChanged={() => void load().then(onSaved)} />}
    </div>
  );
}

function errorText(t: (key: string) => string, cause: unknown): string {
  return t(telegramErrorKey(cause instanceof ApiError ? cause.code : undefined));
}

function BotSection({ app, canManage, onChanged }: { app: TelegramAppView | null; canManage: boolean; onChanged: (app: TelegramAppView) => void }) {
  const t = useT("apps");
  const [token, setToken] = useState("");
  const [editing, setEditing] = useState(!app?.bot);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      onChanged(await saveTelegramBot(token.trim()));
      setToken("");
      setEditing(false);
    } catch (cause) {
      setError(errorText(t, cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t("telegram.bot_title")} subtitle={t("telegram.bot_subtitle")}>
      <div className="space-y-4">
        {app?.bot && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                <Bot size={18} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <a className="text-sm font-semibold text-foreground hover:underline" href={`https://t.me/${app.bot.username}`} target="_blank" rel="noreferrer">
                  <bdi dir="ltr">@{app.bot.username}</bdi>
                </a>
                <p className="text-xs text-muted-foreground">
                  {t("telegram.token_saved")} <bdi dir="ltr">{app.bot.tokenMasked}</bdi>
                </p>
              </div>
            </div>
            {canManage && !editing && (
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                {t("telegram.change_token")}
              </Button>
            )}
          </div>
        )}
        {!app?.bot && (
          <ol className="list-decimal space-y-1 ps-5 text-sm text-muted-foreground">
            <li>{t("telegram.step_1")}</li>
            <li>{t("telegram.step_2")}</li>
            <li>{t("telegram.step_3")}</li>
          </ol>
        )}
        {canManage && editing && (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <FieldRow label={t("telegram.token_label")} help={t("telegram.token_hint")}>
              <Input
                type="password"
                dir="ltr"
                value={token}
                onChange={(event) => setToken(event.currentTarget.value)}
                placeholder={t("telegram.token_placeholder")}
                autoComplete="off"
                spellCheck={false}
              />
            </FieldRow>
            {error && (
              <p role="alert" className="text-sm font-medium text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              {app?.bot && (
                <Button type="button" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
                  {t("telegram.cancel")}
                </Button>
              )}
              <Button type="submit" disabled={busy || token.trim().length === 0}>
                {busy ? t("telegram.saving") : t("telegram.save_token")}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Card>
  );
}

function ChatSection({ app, canManage, onChanged, reload }: { app: TelegramAppView; canManage: boolean; onChanged: (app: TelegramAppView) => void; reload: () => Promise<void> }) {
  const t = useT("apps");
  const locale = useLocale();
  const [pairing, setPairing] = useState<TelegramPairing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<TelegramTest | null>(null);
  const [testing, setTesting] = useState(false);
  const before = useRef<string | null>(null);

  useEffect(() => {
    if (!pairing) return;
    const timer = window.setInterval(async () => {
      if (Date.parse(pairing.expiresAt) <= Date.now()) {
        setPairing(null);
        return;
      }
      try {
        const latest = await getTelegramApp();
        if (latest && connectedSince(latest, before.current)) {
          setPairing(null);
          onChanged(latest);
        }
      } catch {
        // The next tick asks again; the link's expiry ends the wait.
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [pairing]);

  async function connect() {
    setBusy(true);
    setError(null);
    const opening = window.open("", "_blank");
    if (opening) opening.opener = null;
    try {
      const link = await openTelegramPairing();
      before.current = app.chat?.connectedAt ?? null;
      setPairing(link);
      if (opening) opening.location.href = link.url;
      void reload();
    } catch (cause) {
      opening?.close();
      setError(errorText(t, cause));
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    setTest(null);
    setError(null);
    try {
      setTest(await sendTelegramTest());
    } catch (cause) {
      setError(errorText(t, cause));
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card title={t("telegram.chat_title")} subtitle={t("telegram.chat_subtitle")}>
      <div className="space-y-4">
        {app.chat ? (
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
              <MessageCircle size={18} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{app.chat.name ? t("telegram.connected_to", { name: app.chat.name }) : t("telegram.connected")}</p>
              <p className="text-xs text-muted-foreground">{t("telegram.connected_since", { when: relativeTime(app.chat.connectedAt, locale) })}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("telegram.not_connected")}</p>
        )}

        {pairing && (
          <Alert tone="info">
            <span className="block">{t("telegram.waiting")}</span>
            <span className="mt-1 block text-xs">
              {t("telegram.link_expires", { when: relativeTime(pairing.expiresAt, locale) })}{" "}
              <a className="font-semibold underline" href={pairing.url} target="_blank" rel="noreferrer">
                {t("telegram.open_link")}
              </a>
            </span>
          </Alert>
        )}

        {test && (
          <Alert tone={test.delivered ? "success" : "critical"} role="status">
            {test.delivered ? t("telegram.test_sent") : t(`telegram.test_failed.${test.reason ?? "bad_request"}`)}
          </Alert>
        )}
        {error && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        )}

        {canManage && (
          <div className="flex flex-wrap justify-end gap-2">
            {app.chat && (
              <Button variant="secondary" onClick={() => void sendTest()} disabled={testing}>
                <Send size={15} aria-hidden="true" />
                {testing ? t("telegram.testing") : t("telegram.test")}
              </Button>
            )}
            <Button variant={app.chat ? "secondary" : "primary"} onClick={() => void connect()} disabled={busy}>
              <ExternalLink size={15} aria-hidden="true" />
              {app.chat ? t("telegram.reconnect") : t("telegram.connect")}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function NotificationsSection({ app, canManage, onChanged }: { app: TelegramAppView; canManage: boolean; onChanged: (app: TelegramAppView) => void }) {
  const t = useT("apps");
  const events = useT("events");
  const [enabled, setEnabled] = useState(app.enabled);
  const [language, setLanguage] = useState<StoreLocale | "">(app.language ?? "");
  const [chosen, setChosen] = useState<EventType[]>(app.events);

  useEffect(() => {
    setEnabled(app.enabled);
    setLanguage(app.language ?? "");
    setChosen(app.events);
  }, [app]);

  async function save() {
    if (chosen.length === 0) throw new Error(t("telegram.events_required"));
    try {
      onChanged(
        await changeTelegramApp({
          events: chosen,
          language: language === "" ? null : language,
          ...(enabled !== app.enabled ? { enabled } : {}),
        }),
      );
    } catch (cause) {
      throw new Error(errorText(t, cause));
    }
  }

  const toggle = (type: EventType, on: boolean) => setChosen((current) => (on ? [...current, type] : current.filter((candidate) => candidate !== type)));

  return (
    <SettingsSection icon={Bell} title={t("telegram.settings_title")} subtitle={t("telegram.settings_subtitle")} onSave={save} readOnly={!canManage}>
      <SwitchField label={t("telegram.enabled_label")} help={app.chat ? t("telegram.enabled_hint") : t("telegram.enabled_needs_chat")} checked={enabled} onChange={setEnabled} disabled={!app.chat} />
      <FieldRow label={t("telegram.language_label")} help={t("telegram.language_hint")}>
        <Select value={language} onChange={(event) => setLanguage(event.currentTarget.value as StoreLocale | "")}>
          <option value="">{app.language === null ? t("telegram.language_store_now", { language: STORE_LOCALE_INFO[app.writesIn].nativeName }) : t("telegram.language_store")}</option>
          {STORE_LOCALES.map((code) => (
            <option key={code} value={code}>
              {STORE_LOCALE_INFO[code].nativeName}
            </option>
          ))}
        </Select>
      </FieldRow>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium text-foreground">{t("telegram.events_label")}</legend>
        <p className="text-xs text-muted-foreground">{t("telegram.events_hint")}</p>
        {SUBJECTS.map((subject) => (
          <div key={subject} className="grid gap-x-3 rounded-lg border border-border p-2 sm:grid-cols-2">
            {typesOf(subject).map((type) => (
              <label key={type} className="flex min-h-8 cursor-pointer items-center gap-2.5 rounded-md px-1 text-sm text-foreground hover:bg-foreground/[0.04]">
                <input type="checkbox" className="size-4 accent-[var(--primary)]" data-event-type={type} checked={chosen.includes(type)} onChange={(event) => toggle(type, event.currentTarget.checked)} />
                {events(`types.${type}`)}
              </label>
            ))}
          </div>
        ))}
      </fieldset>
    </SettingsSection>
  );
}

/** The Telegram Consumer, and each notification with what Telegram answered. */
function TelegramDeliveries({ consumerId, canManage, onChanged }: { consumerId: string; canManage: boolean; onChanged: () => void }) {
  const t = useT("apps");
  const events = useT("events");
  const [consumer, setConsumer] = useState<EventConsumer | null | undefined>(undefined);

  async function load() {
    try {
      setConsumer((await listEventConsumers()).find((candidate) => candidate.id === consumerId) ?? null);
    } catch {
      setConsumer(null);
    }
  }

  useEffect(() => {
    void load();
  }, [consumerId]);

  return (
    <Card title={t("telegram.deliveries_title")} subtitle={t("telegram.deliveries_subtitle")} flush>
      {consumer === undefined ? (
        <div role="status" aria-busy="true" className="border-t border-border p-4">
          <div className="h-12 shimmer rounded-lg" />
        </div>
      ) : consumer === null ? (
        <p role="alert" className="border-t border-border px-4 py-4 text-sm text-destructive">{events("integrations.load_error")}</p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          <ConsumerRow
            consumer={consumer}
            canManage={canManage}
            onChanged={() => {
              void load();
              onChanged();
            }}
          />
        </ul>
      )}
    </Card>
  );
}
