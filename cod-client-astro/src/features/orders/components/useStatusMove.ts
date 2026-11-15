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
 * order goes along as shown — its status and its calls without an answer —
 * so a move on an order someone else confirmed, cancelled or called
 * meanwhile is refused — one message says so while the order is read
 * again — never applied to what it became. Resolves true when the move was
 * made.
 */
export function useStatusMove(onDone: () => void | Promise<void>, onError: (message: string) => void) {
  const t = useT("orders");
  const common = useT("common");
  const confirm = useConfirmDialog();

  return async function move(order: { id: string; orderNumber: string; status: OrderStatus; unansweredCalls: number }, status: OrderStatus): Promise<boolean> {
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
      await updateOrderStatus(order.id, status, { status: order.status, unansweredCalls: order.unansweredCalls });
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "ORDER_CHANGED") {
        notify.error(t("move.changed"));
        await onDone();
      } else {
        notify.error(t("move.failed"));
        onError(cause instanceof Error ? cause.message : String(cause));
      }
      return false;
    }
    notify.success(t("move.done", { order: order.orderNumber, status: status === "unreachable" ? moveLabel(t, status, order.unansweredCalls) : t(`status.${status}`) }));
    await onDone();
    return true;
  };
}
