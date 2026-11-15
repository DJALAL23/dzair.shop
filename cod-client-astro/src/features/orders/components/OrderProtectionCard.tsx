import { useEffect, useState } from "react";
import { Ban, Flag } from "lucide-react";
import { Button, Card, useConfirmDialog } from "@/components/ui";
import { canScope, useIdentity } from "@/features/auth/components/RequireAuth";
import { useLocale, useT } from "@/i18n/react";
import { decidingFirst, listOf, useMatchName } from "@/features/apps/order-protection/words";
import { notify } from "@/lib/notify";
import { addToBlockList, attemptOfOrder, type OrderAttempt } from "@/features/apps/order-protection/api";
import { AttemptSignalsLine } from "@/features/apps/order-protection/AttemptSignals";
import { SCOPES } from "../../../../../cod-shared/rbac/scopes";

/** What the App made of an order when it came in, or null when it did not screen it or the member may not see it. */
export function useOrderAttempt(orderId: string): OrderAttempt | null {
  const identity = useIdentity();
  const canRead = canScope(identity, SCOPES.ORDER_PROTECTION_READ);
  const [attempt, setAttempt] = useState<OrderAttempt | null>(null);

  useEffect(() => {
    setAttempt(null);
    if (!canRead) return;
    let alive = true;
    attemptOfOrder(orderId)
      .then((found) => alive && setAttempt(found))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [canRead, orderId]);

  return attempt;
}

/** An order the App did not simply let through: it flagged it, or it was rescued from Spam. */
export const protectionNeedsAttention = (attempt: OrderAttempt) => attempt.outcome !== "accepted";

/** On an order the App screened: why it flagged or held it, and blocking who sent it. */
export function OrderProtectionCard({ attempt }: { attempt: OrderAttempt }) {
  const t = useT("apps");
  const locale = useLocale();
  const matchName = useMatchName();
  const confirm = useConfirmDialog();
  const identity = useIdentity();
  const canManage = canScope(identity, SCOPES.ORDER_PROTECTION_MANAGE);

  async function block(kind: "phone" | "ip", value: string) {
    if (kind === "ip") {
      const sure = await confirm({ title: t("order_protection.flag.block_ip_title", { value }), description: t("order_protection.block.ip_warning"), confirmLabel: t("order_protection.flag.block_ip") });
      if (!sure) return;
    }
    try {
      await addToBlockList({ kind, value, ...(attempt.orderNumber ? { note: attempt.orderNumber } : {}) });
      notify.success(t("order_protection.spam.blocked", { phone: value }));
    } catch {
      notify.error(t("order_protection.block.add_failed"));
    }
  }

  const held = attempt.outcome === "flagged" ? "flag" : attempt.outcome === "rescued" ? "spam" : null;
  const reasons = held ? decidingFirst(attempt.matches, held).deciding.map(matchName) : [];

  return (
    <Card title={t("names.order-protection")}>
      {reasons.length > 0 && (
        <p className="mb-3 flex items-start gap-2 text-sm text-[var(--tone-warning-text)]">
          <Flag size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          {t(held === "flag" ? "order_protection.flag.because" : "order_protection.flag.rescued_because", { rules: listOf(reasons, locale) })}
        </p>
      )}
      <div className="mb-3 empty:hidden">
        <AttemptSignalsLine signals={attempt.signals} />
      </div>
      {canManage && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void block("phone", attempt.phone)}>
            <Ban size={14} aria-hidden="true" />
            {t("order_protection.flag.block_phone")}
          </Button>
          {attempt.ipKey && (
            <Button variant="secondary" onClick={() => void block("ip", attempt.ipKey!)}>
              <Ban size={14} aria-hidden="true" />
              {t("order_protection.flag.block_ip")}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
