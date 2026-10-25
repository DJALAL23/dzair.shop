/**
 * Carrier webhooks — received into the inbox and answered at once; the events
 * are processed after the answer, by the drain this request wakes
 * (`src/events/drain.ts`). The URLs are the ones the carriers hold, unchanged.
 *
 * Rules from the carriers' docs:
 *   - the raw body is read before anything parses it (signatures cover the bytes);
 *   - Yalidine wants a 2xx within 10 seconds, retries 7 times over 40 hours,
 *     then disables the webhook — so the answer never waits for processing;
 *   - Yalidine's GET challenge is answered before anything touches the database.
 */

import type { Context } from "hono";
import type { AppContext } from "@/types";
import { getDb } from "@/db";
import { AppError } from "@/lib/errors/classes";
import type { CarrierProvider } from "@/carriers/contract";
import { ERROR_CATEGORIES, ERROR_CODES } from "../../../../cod-shared/errors/codes";
import { receiveWebhook } from "@/inbound/receive";

async function receive(c: Context<AppContext>, provider: CarrierProvider) {
  const rawBody = await c.req.text();
  const received = await receiveWebhook(getDb(c.env.DB), provider, rawBody, c.req.raw.headers);
  if (received.status !== 200) {
    throw new AppError(received.error, ERROR_CODES.INVALID_WEBHOOK_PAYLOAD, ERROR_CATEGORIES.VALIDATION, received.status, { provider });
  }
  return c.json({ received: true }, 200);
}

/** POST /webhooks/zr_express — one Svix event per delivery; `svix-id` is its key. */
export function handleZrWebhook(c: Context<AppContext>) {
  return receive(c, "zr_express");
}

/** POST /webhooks/yalidine — a batch of events of one type; each `event_id` is its key. */
export function handleYalidineWebhook(c: Context<AppContext>) {
  return receive(c, "yalidine");
}

/**
 * GET /webhooks/yalidine — Yalidine's CRC check, at creation, on edit and
 * periodically: echo `crc_token` as plain text. No database, no auth.
 */
export async function handleYalidineChallenge(c: Context<AppContext>) {
  const subscribe = c.req.query("subscribe");
  const crcToken = c.req.query("crc_token");
  if (subscribe !== undefined && crcToken !== undefined) return c.text(crcToken, 200);
  return c.json({ ok: true }, 200);
}
