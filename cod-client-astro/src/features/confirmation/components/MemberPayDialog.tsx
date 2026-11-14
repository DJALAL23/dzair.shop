import { useEffect, useState } from "react";
import { Trash2, Wallet } from "lucide-react";
import { useTeamError } from "@/features/confirmation/errors";
import { useLocale, useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { Button, Dialog, Field, Input, Select, useConfirmDialog } from "@/components/ui";
import { formatMoney } from "@/features/orders/model";
import { listMemberPay, removePayRate, setMemberPay } from "@/features/confirmation/api";
import { payStart } from "@/features/confirmation/model";
import { formatStoreDay, storeDay } from "@/lib/store-time";
import type { PayKind, PayRate, TeamMember } from "@/features/confirmation/types";

const KINDS: PayKind[] = ["salary", "per_confirmed", "per_delivered"];
const MAX_AMOUNT = 10_000_000;

/**
 * A member's pay: a monthly salary, an amount per order they confirm, and
 * an amount per order they confirmed that is delivered — each from a date,
 * so a raise never rewrites a past month. Someone with the finance
 * permission sees it; changing it takes finance management.
 */
export function MemberPayDialog({ member, canManage, onClose, onChanged }: { member: Pick<TeamMember, "userId" | "name">; canManage: boolean; onClose: () => void; onChanged: () => void }) {
  const t = useT("confirmation");
  const explain = useTeamError();
  const locale = useLocale();
  const confirm = useConfirmDialog();
  const [rates, setRates] = useState<PayRate[] | null>(null);
  const [kind, setKind] = useState<PayKind>("salary");
  const [amount, setAmount] = useState("");
  const [from, setFrom] = useState(() => storeDay());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setRates(await listMemberPay(member.userId));
    } catch {
      setRates([]);
      setError(t("pay.load_error"));
    }
  }

  useEffect(() => {
    void load();
  }, [member.userId]);

  const amountValue = Number(amount);
  const valid = amount.trim() !== "" && Number.isInteger(amountValue) && amountValue >= 0 && amountValue <= MAX_AMOUNT && /^\d{4}-\d{2}-\d{2}$/.test(from);
  const starts = payStart(kind, from);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await setMemberPay(member.userId, { kind, amount: amountValue, validFrom: starts });
      notify.success(t("pay.saved"));
      setAmount("");
      await load();
      onChanged();
    } catch (cause) {
      setError(explain(cause, "pay.error"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(rate: PayRate) {
    const ok = await confirm({
      title: t("pay.remove_title"),
      description: t("pay.remove_body", { kind: t(`pay.${rate.kind}`), amount: formatMoney(rate.amount, locale), date: formatStoreDay(rate.validFrom, locale) }),
      confirmLabel: t("pay.remove"),
      tone: "danger",
    });
    if (!ok) return;
    try {
      await removePayRate(rate.id);
      notify.success(t("pay.removed"));
      await load();
      onChanged();
    } catch (cause) {
      setError(explain(cause, "pay.error"));
    }
  }

  return (
    <Dialog placement="end" icon={<Wallet size={17} aria-hidden="true" />} title={t("pay.edit_title", { name: member.name })} description={t("pay.explain")} onClose={onClose}>
      <div className="space-y-5">
        {rates === null ? (
          <div className="h-24 shimmer rounded-lg" />
        ) : rates.length === 0 ? (
          <p className="rounded-lg bg-muted px-3 py-3 text-sm text-muted-foreground">{t("pay.rates_empty")}</p>
        ) : (
          <div className="space-y-3">
            {KINDS.filter((k) => rates.some((rate) => rate.kind === k)).map((k) => (
              <section key={k}>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(`pay.${k}`)}</h3>
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {rates
                    .filter((rate) => rate.kind === k)
                    .map((rate) => (
                      <li key={rate.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <span className="font-semibold tabular-nums text-foreground">{formatMoney(rate.amount, locale)}</span>
                        <span className="ms-auto text-xs text-muted-foreground">{t("pay.from_day", { date: formatStoreDay(rate.validFrom, locale) })}</span>
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => void remove(rate)}
                            aria-label={t("pay.remove")}
                            className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                          >
                            <Trash2 size={14} aria-hidden="true" />
                          </button>
                        )}
                      </li>
                    ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        {canManage && (
          <section className="space-y-3 border-t border-border pt-4">
            <h3 className="text-sm font-semibold text-foreground">{t("pay.add_title")}</h3>
            <Field label={t("pay.kind")}>
              <Select value={kind} onChange={(event) => setKind(event.currentTarget.value as PayKind)}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`pay.${k}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("pay.amount")}>
                <Input type="number" inputMode="numeric" min={0} max={MAX_AMOUNT} value={amount} onChange={(event) => setAmount(event.currentTarget.value)} />
              </Field>
              <Field label={t("pay.from")} hint={/^\d{4}-\d{2}-\d{2}$/.test(from) ? (kind === "salary" && starts !== from ? t("pay.salary_starts", { date: formatStoreDay(starts, locale) }) : t("pay.from_day", { date: formatStoreDay(starts, locale) })) : undefined}>
                <Input type="date" value={from} onChange={(event) => setFrom(event.currentTarget.value)} />
              </Field>
            </div>
            <Button type="button" className="w-full" disabled={!valid || busy} onClick={() => void add()}>
              {t("pay.add_rate")}
            </Button>
          </section>
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
