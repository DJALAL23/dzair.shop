import { useT } from "@/i18n/react";
import { ApiError } from "@/lib/api";
import { notify } from "@/lib/notify";
import { useConfirmDialog } from "@/components/ui";
import { updateOrderStatus } from "@/features/orders/api";
import { moveLabel } from "@/features/orders/model";
import type { OrderStatus } from "@/features/orders/types";

/**
 * Moving an order's processing on: cancelling asks first (stock comes back
 * and the customer's spend is rolled back); the rest happen at once. The
 * order's calls without an answer go along as shown, so a second "No answer"
 * on what someone else just recorded counts no call twice: it is refused and
 * the order is read again. Resolves true when the move was made.
 */
export function useStatusMove(onDone: () => void | Promise<void>, onError: (message: string) => void) {
  const t = useT("orders");
  const common = useT("common");
  const confirm = useConfirmDialog();

  return async function move(order: { id: string; orderNumber: string; unansweredCalls: number }, status: OrderStatus): Promise<boolean> {
    if (status === "cancelled") {
      const accepted = await confirm({
        title: t("move.cancel_title", { order: order.orderNumber }),
        description: t("move.cancel_description"),
        confirmLabel: t("move.cancelled"),
        cancelLabel: common("cancel"),
        tone: "danger",
      });
      if (!accepted) return false;
    }
    try {
      await updateOrderStatus(order.id, status, order.unansweredCalls);
    } catch (cause) {
      notify.error(t("move.failed"));
      if (cause instanceof ApiError && cause.code === "ORDER_CHANGED") {
        await onDone();
        onError(t("move.changed"));
      } else {
        onError(cause instanceof Error ? cause.message : String(cause));
      }
      return false;
    }
    notify.success(t("move.done", { order: order.orderNumber, status: status === "unreachable" ? moveLabel(t, status, order.unansweredCalls) : t(`status.${status}`) }));
    await onDone();
    return true;
  };
}
