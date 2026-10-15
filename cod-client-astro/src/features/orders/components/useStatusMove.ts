import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { useConfirmDialog } from "@/components/ui";
import { updateOrderStatus } from "@/features/orders/api";
import type { OrderStatus } from "@/features/orders/types";

/**
 * Moving an order's processing on: cancelling asks first (stock comes back
 * and the customer's spend is rolled back); the rest happen at once.
 * Resolves true when the move was made.
 */
export function useStatusMove(onDone: () => void | Promise<void>, onError: (message: string) => void) {
  const t = useT("orders");
  const common = useT("common");
  const confirm = useConfirmDialog();

  return async function move(order: { id: string; orderNumber: string }, status: OrderStatus): Promise<boolean> {
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
      await updateOrderStatus(order.id, status);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
      notify.error(t("move.failed"));
      return false;
    }
    notify.success(t("move.done", { order: order.orderNumber, status: t(`status.${status}`) }));
    await onDone();
    return true;
  };
}
