/**
 * Activity Log System
 *
 * Centralized helper for writing audit log entries.
 * Only admins can read activity logs via the API.
 *
 * logActivity() silently swallows errors so that audit failures
 * never break the primary business operation.
 */

import { activityLogs } from "@/db/schema";
import type { AppDb } from "@/db";
import type { AuthUser } from "@/types";

// ─── Action Constants ─────────────────────────────────────────────────────────

export const ACTIONS = {
  // Orders
  ORDER_CREATED:           "order.created",
  ORDER_UPDATED:           "order.updated",
  ORDER_STATUS_CHANGED:    "order.status_changed",
  ORDER_DRIVER_ASSIGNED:   "order.driver_assigned",
  ORDER_DISPATCHED:        "order.dispatched",
  ORDER_PRODUCT_RETURNED:  "order.product_returned",
  ORDER_DELETED:           "order.deleted",
  ORDER_ARCHIVED:          "order.archived",
  ORDER_UNARCHIVED:        "order.unarchived",

  // Shipments
  SHIPMENT_VOIDED:         "shipment.voided",
  SHIPMENT_RELEASED:       "shipment.released",

  // Customers
  CUSTOMER_CREATED:        "customer.created",
  CUSTOMER_UPDATED:        "customer.updated",
  CUSTOMER_DELETED:        "customer.deleted",

  // Customer Groups
  CUSTOMER_GROUP_CREATED:        "customer_group.created",
  CUSTOMER_GROUP_UPDATED:        "customer_group.updated",
  CUSTOMER_GROUP_DELETED:        "customer_group.deleted",
  CUSTOMER_GROUP_MEMBER_ADDED:   "customer_group.member_added",
  CUSTOMER_GROUP_MEMBER_REMOVED: "customer_group.member_removed",

  // Customer Tags
  CUSTOMER_TAG_CREATED:          "customer_tag.created",
  CUSTOMER_TAG_UPDATED:          "customer_tag.updated",
  CUSTOMER_TAG_DELETED:          "customer_tag.deleted",
  CUSTOMER_TAG_ASSIGNED:         "customer_tag.assigned",
  CUSTOMER_TAG_UNASSIGNED:       "customer_tag.unassigned",

  // Drivers
  DRIVER_CREATED:          "driver.created",
  DRIVER_UPDATED:          "driver.updated",
  DRIVER_STATUS_CHANGED:   "driver.status_changed",
  DRIVER_DELETED:          "driver.deleted",

  // Products
  PRODUCT_CREATED:         "product.created",
  PRODUCT_UPDATED:         "product.updated",
  PRODUCT_STATUS_CHANGED:  "product.status_changed",
  PRODUCT_DELETED:         "product.deleted",

  // Landing Pages
  LANDING_PAGE_CREATED:    "landing_page.created",
  LANDING_PAGE_UPDATED:    "landing_page.updated",
  LANDING_PAGE_PUBLISHED:  "landing_page.published",
  LANDING_PAGE_UNPUBLISHED: "landing_page.unpublished",
  LANDING_PAGE_ARCHIVED:   "landing_page.archived",
  LANDING_PAGE_DELETED:    "landing_page.deleted",

  // Store Pages (legal pages + custom pages) — "who rewrote our refund
  // policy, and when" is a question a merchant with staff will ask.
  STORE_PAGE_CREATED:      "store_page.created",
  STORE_PAGE_UPDATED:      "store_page.updated",
  STORE_PAGE_TRANSLATION_SAVED: "store_page.translation_saved",
  STORE_PAGE_TRANSLATION_RESET: "store_page.translation_reset",
  STORE_PAGE_DELETED:      "store_page.deleted",
  STORE_PAGES_SEEDED:      "store_page.seeded",
  STORE_LEGAL_PROFILE_UPDATED: "store_page.legal_profile_updated",

  // Collections
  COLLECTION_CREATED:      "collection.created",
  COLLECTION_UPDATED:      "collection.updated",
  COLLECTION_PRODUCTS_SAVED: "collection.products_saved",
  COLLECTION_DELETED:      "collection.deleted",

  // Navigation menus
  MENU_CREATED:            "menu.created",
  MENU_UPDATED:            "menu.updated",
  MENU_ITEMS_SAVED:        "menu.items_saved",
  MENU_DELETED:            "menu.deleted",

  // Stock
  STOCK_ADJUSTED:          "stock.adjusted",

  // Reviews
  REVIEW_APPROVED:         "review.approved",
  REVIEW_REJECTED:         "review.rejected",
  REVIEW_DELETED:          "review.deleted",
  REVIEW_CREATED:          "review.created",
  REVIEW_MEDIA_REMOVED:    "review.media_removed",

  // Business Events: the merchant's word on who receives them
  EVENT_CONSUMER_ENABLED:  "event_consumer.enabled",
  EVENT_CONSUMER_DISABLED: "event_consumer.disabled",
  EVENT_CONSUMER_REPLAYED: "event_consumer.replayed",
  EVENT_CONSUMER_CREATED:  "event_consumer.created",
  EVENT_CONSUMER_UPDATED:  "event_consumer.updated",
  EVENT_CONSUMER_DELETED:  "event_consumer.deleted",
  EVENT_CONSUMER_SECRET_ROTATED: "event_consumer.secret_rotated",
  EVENT_CONSUMER_TESTED:   "event_consumer.tested",
  EVENT_DELIVERY_RETRIED:  "event_delivery.retried",

  // Users / Team
  USER_CREATED:            "user.created",
  USER_UPDATED:            "user.updated",
  USER_ROLE_CHANGED:       "user.role_changed",
  USER_SCOPE_GRANTED:      "user.scope_granted",
  USER_SCOPE_REVOKED:      "user.scope_revoked",

  // MCP — one row per remote MCP tool call (success or failure),
  // plus one row for user-declined HITL elicitations. Lets ops audit
  // exactly what each AI agent did, and when it was told "no".
  MCP_TOOL_CALLED:         "mcp.tool_called",
  MCP_TOOL_DECLINED:       "mcp.tool_declined",
  /** User or admin revoked an MCP client's access from the /mcp page. */
  MCP_CONNECTION_REVOKED:  "mcp.connection_revoked",
  /** Admin deleted a registered MCP client and revoked all its grants. */
  MCP_CLIENT_DELETED:      "mcp.client_deleted",
} as const;

export type ActivityAction = (typeof ACTIONS)[keyof typeof ACTIONS];

// ─── Helper ───────────────────────────────────────────────────────────────────

export async function logActivity(
  db: AppDb,
  actor: Pick<AuthUser, "id" | "name" | "role">,
  action: ActivityAction,
  entity: { type: string; id: string; label?: string | null },
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(activityLogs).values({
      id: crypto.randomUUID(),
      actorId: actor.id,
      actorName: actor.name ?? "Unknown",
      actorRole: actor.role,
      action,
      entityType: entity.type,
      entityId: entity.id,
      entityLabel: entity.label ?? null,
      metadata: metadata ? JSON.stringify(metadata) : null,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[activity] Failed to log:", action, entity.id, err);
  }
}

/** Ten values a row; D1 binds at most 100 per statement. */
const ACTIVITY_ROWS_PER_INSERT = 9;

/**
 * Several entries of one action — a bulk operation's — written in one trip
 * to the database. Like logActivity, a failure is logged and never breaks
 * the operation.
 */
export async function logActivities(
  db: AppDb,
  actor: Pick<AuthUser, "id" | "name" | "role">,
  action: ActivityAction,
  entries: ReadonlyArray<{ entity: { type: string; id: string; label?: string | null }; metadata?: Record<string, unknown> }>,
): Promise<void> {
  if (entries.length === 0) return;
  const createdAt = new Date().toISOString();
  const rows = entries.map(({ entity, metadata }) => ({
    id: crypto.randomUUID(),
    actorId: actor.id,
    actorName: actor.name ?? "Unknown",
    actorRole: actor.role,
    action,
    entityType: entity.type,
    entityId: entity.id,
    entityLabel: entity.label ?? null,
    metadata: metadata ? JSON.stringify(metadata) : null,
    createdAt,
  }));
  const statements = [];
  for (let start = 0; start < rows.length; start += ACTIVITY_ROWS_PER_INSERT) {
    statements.push(db.insert(activityLogs).values(rows.slice(start, start + ACTIVITY_ROWS_PER_INSERT)));
  }
  try {
    await db.batch(statements as [(typeof statements)[number], ...typeof statements]);
  } catch (err) {
    console.error("[activity] Failed to log:", action, entries.length, err);
  }
}
