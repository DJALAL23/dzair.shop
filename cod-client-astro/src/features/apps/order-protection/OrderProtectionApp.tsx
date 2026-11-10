import { useCallback, useEffect, useState } from "react";
import { Ban, CheckCircle2, Flag, Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, EmptyState, Field, IconButton, Input, LinkButton, Pagination, Select, Switch, Tabs, useConfirmDialog, type BadgeTone } from "@/components/ui";
import { useLocale, useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { relativeTime } from "@/lib/relative-time";
import type { AppBodyProps } from "@/features/apps/types";
import { addToBlockList, chooseTemplate, deleteRule, getProtection, listAttempts, listBlockList, removeFromBlockList, setProtectionEnabled, setRuleMode, type ProtectionRule, type ProtectionState } from "@/features/apps/order-protection/api";
import { ConditionSummary } from "@/features/apps/order-protection/RuleSummary";
import { listOf, ruleName, useMatchName } from "@/features/apps/order-protection/words";
import { formatMoney } from "@/features/orders/model";
import { useOffsetPage } from "@/hooks/use-offset-page";
import { wilayaLabel } from "@/lib/places";
import { RULE_MODES, type RuleAction, type RuleMode } from "../../../../../cod-shared/order-screening/conditions";
import { BLOCK_LIST_KINDS, ORDER_ATTEMPT_OUTCOMES, type BlockListKind, type OrderAttemptOutcome } from "../../../../../cod-shared/order-screening/signals";
import { DEFAULT_TEMPLATE, TEMPLATE_KEYS, type TemplateKey } from "../../../../../cod-shared/order-screening/templates";

const PAGE_SIZE = 20;
const RULE_PAGE = "/apps/order-protection/rule";
const SPAM_PAGE = "/orders/spam";

const ACTION_ICON = { spam: Ban, flag: Flag, accept: CheckCircle2 } satisfies Record<RuleAction, unknown>;
const OUTCOME_TONE: Record<OrderAttemptOutcome, BadgeTone> = { accepted: "neutral", flagged: "warning", spam: "critical", rescued: "info" };

function TemplatePicker({ canManage, onChosen, onCancel, replacing = 0 }: { canManage: boolean; onChosen: (state: ProtectionState) => void; onCancel?: () => void; replacing?: number }) {
  const t = useT("apps");
  const confirm = useConfirmDialog();
  const [selected, setSelected] = useState<TemplateKey>(DEFAULT_TEMPLATE);
  const [busy, setBusy] = useState(false);

  async function apply() {
    if (replacing > 0) {
      const sure = await confirm({ title: t("order_protection.templates.replace_title", { count: replacing }), description: t("order_protection.templates.replace_body", { template: t(`order_protection.templates.${selected}`) }), confirmLabel: t("order_protection.templates.replace") });
      if (!sure) return;
    }
    setBusy(true);
    try {
      onChosen(await chooseTemplate(selected));
    } catch {
      notify.error(t("order_protection.save_failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t("order_protection.templates.title")} subtitle={t("order_protection.templates.subtitle")}>
      <div role="radiogroup" aria-label={t("order_protection.templates.title")} className="grid gap-3 md:grid-cols-3">
        {TEMPLATE_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={selected === key}
            disabled={!canManage}
            onClick={() => setSelected(key)}
            className={`flex flex-col justify-start rounded-xl border p-4 text-start transition-colors ${selected === key ? "border-foreground bg-foreground/[0.03]" : "border-border hover:bg-foreground/[0.02]"}`}
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
              {t(`order_protection.templates.${key}`)}
              {key === DEFAULT_TEMPLATE && <Badge tone="success" size="sm">{t("order_protection.templates.recommended_badge")}</Badge>}
            </span>
            <span className="mt-1 block text-sm text-muted-foreground">{t(`order_protection.templates.${key}_hint`)}</span>
          </button>
        ))}
      </div>
      {canManage && (
        <div className="mt-4 flex justify-end gap-2">
          {onCancel && (
            <Button variant="secondary" onClick={onCancel} disabled={busy}>
              {t("order_protection.templates.cancel")}
            </Button>
          )}
          <Button onClick={() => void apply()} disabled={busy}>
            {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
            {t("order_protection.templates.apply")}
          </Button>
        </div>
      )}
    </Card>
  );
}

function RuleRow({ rule, canManage, onChanged }: { rule: ProtectionRule; canManage: boolean; onChanged: () => Promise<void> }) {
  const t = useT("apps");
  const locale = useLocale();
  const name = ruleName(rule, locale);
  const confirm = useConfirmDialog();
  const Icon = ACTION_ICON[rule.action];

  async function changeMode(mode: RuleMode) {
    try {
      await setRuleMode(rule.id, mode);
      await onChanged();
    } catch {
      notify.error(t("order_protection.save_failed"));
    }
  }

  async function remove() {
    const sure = await confirm({ title: t("order_protection.rules.delete_title", { name }), description: t("order_protection.rules.delete_body"), confirmLabel: t("order_protection.rules.delete") });
    if (!sure) return;
    try {
      await deleteRule(rule.id);
      await onChanged();
    } catch {
      notify.error(t("order_protection.save_failed"));
    }
  }

  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <a href={`${RULE_PAGE}?id=${rule.id}`} className="block truncate text-sm font-semibold text-foreground underline-offset-2 hover:underline">
          <bdi>{name}</bdi>
        </a>
        {rule.conditions ? (
          <ul className="space-y-0.5 text-sm text-muted-foreground">
            {rule.conditions.map((condition, index) => (
              <li key={index}>
                <ConditionSummary condition={condition} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[var(--tone-warning-text)]">{t("order_protection.rules.unavailable")}</p>
        )}
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icon size={13} aria-hidden="true" />
          {t(`order_protection.actions.${rule.action}`)}
          <span aria-hidden="true">·</span>
          {rule.mode === "off" ? t("order_protection.mode_hints.off") : t(rule.mode === "trial" ? `order_protection.rules.would.${rule.action}` : "order_protection.rules.matched", { count: rule.matchesLastWeek })}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {canManage ? (
          <Select variant="pill" aria-label={t("order_protection.rules.mode")} value={rule.mode} onChange={(event) => void changeMode(event.currentTarget.value as RuleMode)}>
            {RULE_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {t(`order_protection.modes.${mode}`)}
              </option>
            ))}
          </Select>
        ) : (
          <Badge>{t(`order_protection.modes.${rule.mode}`)}</Badge>
        )}
        {canManage && (
          <IconButton aria-label={t("order_protection.rules.delete")} onClick={() => void remove()}>
            <Trash2 size={15} aria-hidden="true" />
          </IconButton>
        )}
      </div>
    </li>
  );
}

function RulesTab({ state, canManage, reload, onChosen }: { state: ProtectionState; canManage: boolean; reload: () => Promise<void>; onChosen: (state: ProtectionState) => void }) {
  const t = useT("apps");
  const [choosing, setChoosing] = useState(false);

  if (choosing) return <TemplatePicker canManage={canManage} replacing={state.rules.length} onCancel={() => setChoosing(false)} onChosen={(next) => { setChoosing(false); onChosen(next); }} />;

  return (
    <div className="space-y-3">
      {canManage && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setChoosing(true)}>{t("order_protection.templates.use")}</Button>
          <LinkButton href={RULE_PAGE}>
            <Plus size={14} aria-hidden="true" />
            {t("order_protection.rules.new")}
          </LinkButton>
        </div>
      )}
      {state.rules.length === 0 ? (
        <EmptyState icon={<ShieldCheck size={20} aria-hidden="true" />} title={t("order_protection.rules.empty")} description={t("order_protection.rules.empty_hint")} />
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-border">
            {state.rules.map((rule) => (
              <RuleRow key={rule.id} rule={rule} canManage={canManage} onChanged={reload} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function BlockListTab({ canManage }: { canManage: boolean }) {
  const t = useT("apps");
  const locale = useLocale();
  const { rows: entries, total, page, setPage, pageCount, reload } = useOffsetPage(listBlockList, PAGE_SIZE, () => notify.error(t("order_protection.load_failed")));
  const [kind, setKind] = useState<BlockListKind>("phone");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    try {
      await addToBlockList({ kind, value, ...(note.trim() ? { note: note.trim() } : {}) });
      setValue("");
      setNote("");
      await reload();
    } catch {
      notify.error(t("order_protection.block.add_failed"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await removeFromBlockList(id);
      await reload();
    } catch {
      notify.error(t("order_protection.save_failed"));
    }
  }

  return (
    <div className="space-y-3">
      <Alert tone="info">{t("order_protection.block.always")}</Alert>
      {canManage && (
        <Card>
          <div className="grid gap-3 sm:grid-cols-[10rem_1fr_1fr_auto] sm:items-start">
            <Field label={t("order_protection.block.kind")}>
              <Select value={kind} onChange={(event) => setKind(event.currentTarget.value as BlockListKind)}>
                {BLOCK_LIST_KINDS.map((option) => (
                  <option key={option} value={option}>
                    {t(`order_protection.block.kinds.${option}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("order_protection.block.value")} hint={kind === "ip" ? t("order_protection.block.ip_warning") : undefined}>
              <Input dir="ltr" placeholder={t(`order_protection.block.placeholders.${kind}`)} value={value} onChange={(event) => setValue(event.currentTarget.value)} />
            </Field>
            <Field label={t("order_protection.block.note")}>
              <Input value={note} maxLength={200} onChange={(event) => setNote(event.currentTarget.value)} />
            </Field>
            <Button className="sm:mt-6" onClick={() => void add()} disabled={busy || !value.trim()}>{t("order_protection.block.add")}</Button>
          </div>
        </Card>
      )}
      {entries === null ? null : entries.length === 0 ? (
        <EmptyState icon={<Ban size={20} aria-hidden="true" />} title={t("order_protection.block.empty")} />
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-border">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground" dir="ltr">{entry.value}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {t(`order_protection.block.kinds.${entry.kind}`)}
                    {" · "}
                    <time dateTime={entry.createdAt}>{t("order_protection.block.added", { when: relativeTime(entry.createdAt, locale) })}</time>
                    {entry.note && (
                      <>
                        {" · "}
                        <bdi>{entry.note}</bdi>
                      </>
                    )}
                  </p>
                </div>
                {canManage && (
                  <IconButton aria-label={t("order_protection.block.remove")} onClick={() => void remove(entry.id)}>
                    <Trash2 size={15} aria-hidden="true" />
                  </IconButton>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {total > PAGE_SIZE && <Pagination page={page} totalPages={pageCount} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} />}
    </div>
  );
}

function ActivityTab() {
  const t = useT("apps");
  const locale = useLocale();
  const matchName = useMatchName();
  const [outcome, setOutcome] = useState<OrderAttemptOutcome | "">("");
  const fetchPage = useCallback((page: { limit: number; offset: number }) => listAttempts({ outcome: outcome || undefined, ...page }), [outcome]);
  const { rows: attempts, total, page, setPage, pageCount } = useOffsetPage(fetchPage, PAGE_SIZE, () => notify.error(t("order_protection.load_failed")));

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Select variant="pill" aria-label={t("order_protection.activity.outcome")} value={outcome} onChange={(event) => setOutcome(event.currentTarget.value as OrderAttemptOutcome | "")}>
          <option value="">{t("order_protection.activity.all")}</option>
          {ORDER_ATTEMPT_OUTCOMES.map((option) => (
            <option key={option} value={option}>
              {t(`order_protection.outcomes.${option}`)}
            </option>
          ))}
        </Select>
      </div>
      {attempts === null ? null : attempts.length === 0 ? (
        <EmptyState icon={<ShieldCheck size={20} aria-hidden="true" />} title={t("order_protection.activity.empty")} />
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-border">
            {attempts.map((attempt) => {
              const href = attempt.orderId ? `/orders/${attempt.orderId}` : attempt.outcome === "spam" ? SPAM_PAGE : null;
              const place = wilayaLabel(attempt.wilayaId, null, locale);
              const details = [attempt.customerName, place, attempt.total !== null ? formatMoney(attempt.total, locale) : null].filter((part): part is string => Boolean(part));
              const reasons = attempt.matches.map((match) => (match.mode === "trial" ? t("order_protection.activity.trial_match", { rule: matchName(match) }) : matchName(match)));
              const body = (
                <>
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-medium text-foreground">
                      {attempt.orderNumber}
                      {" · "}
                      <span dir="ltr">{attempt.phone}</span>
                    </p>
                    {details.length > 0 && <p className="truncate text-sm text-muted-foreground"><bdi>{details.join(" · ")}</bdi></p>}
                    {reasons.length > 0 && <p className="truncate text-xs text-muted-foreground">{t("order_protection.activity.matched", { rules: listOf(reasons, locale) })}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={OUTCOME_TONE[attempt.outcome]}>{t(`order_protection.outcomes.${attempt.outcome}`)}</Badge>
                    <time className="text-xs text-muted-foreground" dateTime={attempt.createdAt}>{relativeTime(attempt.createdAt, locale)}</time>
                  </div>
                </>
              );
              const row = "flex flex-col gap-1 p-4 sm:flex-row sm:items-center sm:justify-between";
              return (
                <li key={attempt.id}>
                  {href ? <a href={href} className={`${row} transition-colors hover:bg-foreground/[0.02]`}>{body}</a> : <div className={row}>{body}</div>}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      {total > PAGE_SIZE && <Pagination page={page} totalPages={pageCount} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} />}
    </div>
  );
}

type TabKey = "rules" | "block" | "activity";

/** The Order Protection App: choose a Template, then keep the rules, the Block List and an eye on what happened. */
export default function OrderProtectionApp({ canManage, onSaved }: AppBodyProps) {
  const t = useT("apps");
  const [state, setState] = useState<ProtectionState | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<TabKey>("rules");

  const reload = useCallback(async () => {
    setState(await getProtection());
  }, []);

  useEffect(() => {
    reload().catch(() => setFailed(true));
  }, [reload]);

  function chosen(next: ProtectionState) {
    setState(next);
    onSaved();
  }

  async function toggle(enabled: boolean) {
    try {
      await setProtectionEnabled(enabled);
      setState((current) => current && { ...current, enabled });
      onSaved();
    } catch {
      notify.error(t("order_protection.save_failed"));
    }
  }

  if (failed) return <Alert tone="critical" role="alert">{t("order_protection.load_failed")}</Alert>;
  if (!state) return <div role="status" aria-busy="true" className="flex min-h-40 items-center justify-center"><Loader2 size={22} className="animate-spin text-muted-foreground" /></div>;
  if (state.enabled === null) return <TemplatePicker canManage={canManage} onChosen={chosen} />;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-foreground">{t("order_protection.switch")}</p>
            <p className="text-sm text-muted-foreground">{t("order_protection.switch_hint")}</p>
          </div>
          <Switch checked={state.enabled} disabled={!canManage} aria-label={t("order_protection.switch")} onChange={(enabled) => void toggle(enabled)} />
        </div>
      </Card>
      <Tabs<TabKey>
        label={t("names.order-protection")}
        value={tab}
        onChange={setTab}
        items={[
          { key: "rules", label: t("order_protection.tabs.rules"), count: state.rules.length },
          { key: "block", label: t("order_protection.tabs.block") },
          { key: "activity", label: t("order_protection.tabs.activity") },
        ]}
      />
      {tab === "rules" && <RulesTab state={state} canManage={canManage} reload={reload} onChosen={chosen} />}
      {tab === "block" && <BlockListTab canManage={canManage} />}
      {tab === "activity" && <ActivityTab />}
    </div>
  );
}
