/**
 * Who may see and steer a Consumer, and its Deliveries: its owner's
 * permissions (Apps context) — the Meta App's for Meta conversions,
 * Integrations' for webhooks. What the caller may not see is not found; what
 * they may see but not steer is refused.
 */

import type { Context } from "hono";
import type { AppContext } from "@/types";
import type { AppDb } from "@/db";
import { NotFoundError, PermissionError } from "@/lib/errors/classes";
import { consumerKindsFor, consumerPermissions, mayConsumer } from "../../../../cod-shared/apps/catalog";
import { readConsumerRow, readDelivery } from "../../../../cod-shared/events/consumers";

export type Access = "read" | "manage";

/** The Consumer Kinds the caller may see. */
export function readableKinds(c: Context<AppContext>): string[] {
  return consumerKindsFor(c.get("user").scopes, "read");
}

function assertAccess(c: Context<AppContext>, kind: string | undefined, access: Access, notFound: () => NotFoundError): void {
  const scopes = c.get("user").scopes;
  if (kind === undefined || !mayConsumer(scopes, kind, "read")) throw notFound();
  if (access === "manage" && !mayConsumer(scopes, kind, "manage")) {
    const required = consumerPermissions(kind)!.manage;
    throw new PermissionError(`Steering this Consumer takes ${required}`, required);
  }
}

/** The Consumer, when the caller may see it — and steer it, for `manage`. */
export async function consumerWithAccess(c: Context<AppContext>, db: AppDb, id: string, access: Access) {
  const consumer = await readConsumerRow(db, id);
  assertAccess(c, consumer?.kind, access, () => new NotFoundError("Event Consumer", id));
  return consumer!;
}

/** The Delivery, when the caller may see its Consumer — and steer it, for `manage`. */
export async function deliveryWithAccess(c: Context<AppContext>, db: AppDb, id: string, access: Access) {
  const delivery = await readDelivery(db, id);
  const consumer = delivery ? await readConsumerRow(db, delivery.consumerId) : null;
  assertAccess(c, consumer?.kind, access, () => new NotFoundError("Event Delivery", id));
  return delivery!;
}
