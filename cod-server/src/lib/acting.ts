/**
 * Who acts at a cod-server entry point. Two things are needed of them: the
 * Author of what changes, for its Business Event; and the staff member whose
 * permissions are checked and whose name signs the activity log — none for
 * the system.
 */

import type { Context } from "hono";
import type { AppContext, StaffActor } from "@/types";
import type { Author } from "../../../cod-shared/events/actor";

export interface Acting {
  author: Author;
  staff: StaffActor | null;
}

/** A request through the merchant API: the signed-in staff member, from the dashboard or with their key. */
export function actingOf(c: Context<AppContext>): Acting & { staff: StaffActor } {
  return { author: c.get("author"), staff: c.get("user") };
}

/** The system, on a schedule. */
export const SYSTEM_ACTING: Acting = { author: { actor: { kind: "system", id: null, name: null }, origin: "schedule" }, staff: null };

/** What a carrier reports about its parcels — through its webhook, or read back by a sync. */
export function carrierAuthor(company: { id: string; name: string }, origin: "carrier_webhook" | "carrier_sync"): Author {
  return { actor: { kind: "carrier", id: company.id, name: company.name }, origin };
}
