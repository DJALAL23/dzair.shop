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

/** On an order the App screened: why it was flagged, and blocking who sent it. Nothing at all otherwise. */
export function OrderProtectionCard({ orderId }: { orderId: string }) {
  const t = useT("apps");
  const locale = useLocale();
  const matchName = useMatchName();
  const confirm = useConfirmDialog();
  const identity = useIdentity();
  const canRead = canScope(identity, SCOPES.ORDER_PROTECTION_READ);
  const canManage = canScope(identity, SCOPES.ORDER_PROTECTION_MANAGE);
  const [attempt, setAttempt] = useState<OrderAttempt | null>(null);

  useEffect(() => {
    if (!canRead) return;
    let alive = true;
    attemptOfOrder(orderId)
      .then((found) => alive && setAttempt(found))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [canRead, orderId]);

  if (!attempt) return null;

  async function block(kind: "phone" | "ip", value: string) {
    if (kind === "ip") {
      const sure = await confirm({ title: t("order_protection.flag.block_ip_title", { value }), description: t("order_protection.block.ip_warning"), confirmLabel: t("order_protection.flag.block_ip") });
      if (!sure) return;
    }
    try {
      await addToBlockList({ kind, value, ...(attempt?.orderNumber ? { note: attempt.orderNumber } : {}) });
      notify.success(t("order_protection.spam.blocked", { phone: value }));
    } catch {
      notify.error(t("order_protection.block.add_failed"));
    }
  }

  const reasons = decidingFirst(attempt.matches, "flag").deciding.map(matchName);

  return (
    <Card title={t("names.order-protection")}>
      {attempt.outcome === "flagged" && reasons.length > 0 && (
        <p className="mb-3 flex items-start gap-2 text-sm text-[var(--tone-warning-text)]">
          <Flag size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          {t("order_protection.flag.because", { rules: listOf(reasons, locale) })}
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
