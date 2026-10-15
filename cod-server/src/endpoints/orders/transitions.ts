/**
 * Whether an order may move to a status now, by the order lifecycle
 * (`cod-shared/orders/lifecycle.ts`) — shared by the route and the AI tool.
 * An order still in an old delivery status (until the split migration moves
 * it onto its shipment) has no further status change.
 */

import { checkTransition, isOrderStatus, type OrderStatus } from "../../../../cod-shared/orders/lifecycle";
import { ERROR_CODES } from "../../../../cod-shared/errors/codes";

export type TransitionVerdict =
  | { ok: true }
  | { ok: false; code: typeof ERROR_CODES.ORDER_HAS_SHIPMENT }
  | { ok: false; code: typeof ERROR_CODES.INVALID_STATUS_TRANSITION; allowed: readonly OrderStatus[] };

export function transitionVerdict(current: string, hasShipment: boolean, to: OrderStatus): TransitionVerdict {
  if (!isOrderStatus(current)) return { ok: false, code: ERROR_CODES.INVALID_STATUS_TRANSITION, allowed: [] };
  const verdict = checkTransition({ status: current, hasShipment }, to);
  if (verdict.ok) return verdict;
  if (verdict.code === ERROR_CODES.ORDER_HAS_SHIPMENT) return { ok: false, code: verdict.code };
  if (verdict.code === ERROR_CODES.INVALID_STATUS_TRANSITION) return { ok: false, code: verdict.code, allowed: verdict.allowed };
  throw new Error(`Unexpected lifecycle verdict ${verdict.code}`);
}
