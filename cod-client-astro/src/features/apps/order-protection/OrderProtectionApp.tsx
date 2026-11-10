import { useCallback, useEffect, useState } from "react";
import { Ban, CheckCircle2, Flag, Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, CellEmpty, Dialog, EmptyState, Field, FilterPill, IconButton, Input, LinkButton, ListToolbar, Pagination, RowActions, Select, Switch, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableSkeleton, Tabs, showRowOnClick, useConfirmDialog } from "@/components/ui";
import { useLocale, useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { relativeTime } from "@/lib/relative-time";
import type { AppBodyProps } from "@/features/apps/types";
import { addToBlockList, chooseTemplate, deleteRule, getProtection, listAttempts, listBlockList, removeFromBlockList, setProtectionEnabled, setRuleMode, type ProtectionRule, type ProtectionState } from "@/features/apps/order-protection/api";
import { ConditionSummary } from "@/features/apps/order-protection/RuleSummary";
import { AttemptCustomer, AttemptSheet, OUTCOME_TONE } from "@/features/apps/order-protection/AttemptSheet";
import { ruleName } from "@/features/apps/order-protection/words";
import { formatMoney } from "@/features/orders/model";
import { useOffsetPage } from "@/hooks/use-offset-page";
import { RULE_MODES, type RuleAction, type RuleMode } from "../../../../../cod-shared/order-screening/conditions";
import { BLOCK_LIST_KINDS, ORDER_ATTEMPT_OUTCOMES, type BlockListKind, type OrderAttemptOutcome } from "../../../../../cod-shared/order-screening/signals";
import { DEFAULT_TEMPLATE, TEMPLATE_KEYS, type TemplateKey } from "../../../../../cod-shared/order-screening/templates";

const PAGE_SIZE = 20;
const RULE_PAGE = "/apps/order-protection/rule";
const SPAM_PAGE = "/orders/spam";

const ACTION_ICON = { spam: Ban, flag: Flag, accept: CheckCircle2 } satisfies Record<RuleAction, unknown>;

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

function AddToBlockList({ onClose, onAdded }: { onClose: () => void; onAdded: () => Promise<void> }) {
  const t = useT("apps");
  const [kind, setKind] = useState<BlockListKind>("phone");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    try {
      await addToBlockList({ kind, value: value.trim(), ...(note.trim() ? { note: note.trim() } : {}) });
      await onAdded();
      onClose();
    } catch {
      notify.error(t("order_protection.block.add_failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      onClose={onClose}
      icon={<Ban size={17} aria-hidden="true" />}
      title={t("order_protection.block.add_title")}
      description={t("order_protection.block.add_hint")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>{t("order_protection.templates.cancel")}</Button>
          <Button onClick={() => void add()} disabled={busy || !value.trim()}>
            {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
            {t("order_protection.block.add")}
          </Button>
        </>
      }
    >
      <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); if (value.trim()) void add(); }}>
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
      </form>
    </Dialog>
  );
}

function BlockListTab({ canManage }: { canManage: boolean }) {
  const t = useT("apps");
  const locale = useLocale();
  const { rows: entries, total, page, setPage, pageCount, reload } = useOffsetPage(listBlockList, PAGE_SIZE, () => notify.error(t("order_protection.load_failed")));
  const [adding, setAdding] = useState(false);

  async function remove(id: string) {
    try {
      await removeFromBlockList(id);
      await reload();
    } catch {
      notify.error(t("order_protection.save_failed"));
    }
  }

  const removeButton = (id: string) =>
    canManage && (
      <IconButton aria-label={t("order_protection.block.remove")} title={t("order_protection.block.remove")} variant="danger" onClick={() => void remove(id)}>
        <Trash2 size={15} aria-hidden="true" />
      </IconButton>
    );
  const added = (createdAt: string) => <time dateTime={createdAt}>{t("order_protection.block.added", { when: relativeTime(createdAt, locale) })}</time>;

  return (
    <div className="space-y-3">
      <Alert tone="info">{t("order_protection.block.always")}</Alert>
      <Card flush className="overflow-hidden">
        {canManage && (
          <div className="flex justify-end p-2">
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus size={14} aria-hidden="true" />
              {t("order_protection.block.new")}
            </Button>
          </div>
        )}
        {entries === null ? (
          <TableSkeleton rows={4} columns={4} />
        ) : entries.length === 0 ? (
          <EmptyState icon={<Ban size={20} aria-hidden="true" />} title={t("order_protection.block.empty")} />
        ) : (
          <>
            <ul className="divide-y divide-border border-t border-border md:hidden">
              {entries.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground" dir="ltr">{entry.value}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {t(`order_protection.block.kinds.${entry.kind}`)}
                      {" · "}
                      {added(entry.createdAt)}
                      {entry.note && <>{" · "}<bdi>{entry.note}</bdi></>}
                    </p>
                  </div>
                  {removeButton(entry.id)}
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>{t("order_protection.table.blocked")}</TableHead>
                    <TableHead>{t("order_protection.block.kind")}</TableHead>
                    <TableHead>{t("order_protection.block.note")}</TableHead>
                    <TableHead className="text-end">{t("order_protection.table.added")}</TableHead>
                    {canManage && (
                      <TableHead className="w-px">
                        <span className="sr-only">{t("order_protection.block.remove")}</span>
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="font-medium" dir="ltr">{entry.value}</TableCell>
                      <TableCell className="text-muted-foreground">{t(`order_protection.block.kinds.${entry.kind}`)}</TableCell>
                      <TableCell className="max-w-64 truncate text-muted-foreground">{entry.note ? <bdi>{entry.note}</bdi> : <CellEmpty />}</TableCell>
                      <TableCell className="whitespace-nowrap text-end text-muted-foreground">{added(entry.createdAt)}</TableCell>
                      {canManage && (
                        <TableCell className="w-px">
                          <RowActions>{removeButton(entry.id)}</RowActions>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </Card>
      {total > PAGE_SIZE && <Pagination page={page} totalPages={pageCount} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} />}
      {adding && <AddToBlockList onClose={() => setAdding(false)} onAdded={reload} />}
    </div>
  );
}

function ActivityTab() {
  const t = useT("apps");
  const common = useT("common");
  const locale = useLocale();
  const [outcome, setOutcome] = useState<OrderAttemptOutcome | "">("");
  const [openId, setOpenId] = useState<string | null>(null);
  const fetchPage = useCallback((page: { limit: number; offset: number }) => listAttempts({ outcome: outcome || undefined, ...page }), [outcome]);
  const { rows: attempts, total, page, setPage, pageCount } = useOffsetPage(fetchPage, PAGE_SIZE, () => notify.error(t("order_protection.load_failed")));
  const opened = attempts?.find((attempt) => attempt.id === openId) ?? null;
  const link = opened?.orderId ? { href: `/orders/${opened.orderId}`, label: t("order_protection.sheet.open_order") } : opened?.outcome === "spam" ? { href: SPAM_PAGE, label: t("order_protection.sheet.open_spam") } : null;

  return (
    <div className="space-y-3">
      <Card flush className="overflow-hidden">
        <ListToolbar count={attempts && total > 0 ? t("order_protection.activity.count", { count: total }) : undefined}>
          <FilterPill label={t("order_protection.activity.outcome")} value={outcome} onChange={(value) => setOutcome(value as OrderAttemptOutcome | "")}>
            <option value="">{t("order_protection.activity.all")}</option>
            {ORDER_ATTEMPT_OUTCOMES.map((option) => (
              <option key={option} value={option}>
                {t(`order_protection.outcomes.${option}`)}
              </option>
            ))}
          </FilterPill>
        </ListToolbar>
        {attempts === null ? (
          <TableSkeleton columns={6} />
        ) : attempts.length === 0 ? (
          <EmptyState icon={<ShieldCheck size={20} aria-hidden="true" />} title={t("order_protection.activity.empty")} />
        ) : (
          <>
            <div className="divide-y divide-border border-t border-border md:hidden">
              {attempts.map((attempt) => (
                <button key={attempt.id} type="button" onClick={() => setOpenId(attempt.id)} className="block w-full space-y-1 px-4 py-3 text-start">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm font-medium text-foreground"><bdi>{attempt.customerName ?? attempt.phone}</bdi></span>
                    <Badge tone={OUTCOME_TONE[attempt.outcome]} size="sm">{t(`order_protection.outcomes.${attempt.outcome}`)}</Badge>
                  </span>
                  <span className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span className="truncate">{[attempt.orderNumber, attempt.total !== null ? formatMoney(attempt.total, locale) : null].filter(Boolean).join(" · ")}</span>
                    <time className="shrink-0" dateTime={attempt.createdAt}>{relativeTime(attempt.createdAt, locale)}</time>
                  </span>
                </button>
              ))}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>{t("order_protection.table.customer")}</TableHead>
                    <TableHead>{t("order_protection.table.order")}</TableHead>
                    <TableHead numeric>{t("order_protection.table.total")}</TableHead>
                    <TableHead>{t("order_protection.activity.outcome")}</TableHead>
                    <TableHead className="text-end">{t("order_protection.table.when")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attempts.map((attempt) => (
                      <TableRow key={attempt.id} onClick={showRowOnClick(() => setOpenId(attempt.id))} className="cursor-pointer">
                        <TableCell className="max-w-56">
                          <AttemptCustomer attempt={attempt} onOpen={() => setOpenId(attempt.id)} />
                        </TableCell>
                        <TableCell className="text-muted-foreground">{attempt.orderNumber ?? <CellEmpty />}</TableCell>
                        <TableCell numeric>{attempt.total !== null ? formatMoney(attempt.total, locale) : <CellEmpty />}</TableCell>
                        <TableCell>
                          <Badge tone={OUTCOME_TONE[attempt.outcome]} size="sm">{t(`order_protection.outcomes.${attempt.outcome}`)}</Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-end text-muted-foreground">
                          <time dateTime={attempt.createdAt}>{relativeTime(attempt.createdAt, locale)}</time>
                        </TableCell>
                      </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </Card>
      {total > PAGE_SIZE && <Pagination page={page} totalPages={pageCount} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} />}
      {opened && (
        <AttemptSheet
          attempt={opened}
          withTrials
          onClose={() => setOpenId(null)}
          footer={link ? <LinkButton href={link.href}>{link.label}</LinkButton> : <Button variant="secondary" onClick={() => setOpenId(null)}>{common("close")}</Button>}
        />
      )}
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
