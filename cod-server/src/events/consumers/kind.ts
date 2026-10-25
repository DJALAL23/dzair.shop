/**
 * A Consumer Kind: how one kind of Consumer is reached — a webhook, Meta
 * conversions, a Telegram chat. The drain hands it one claimed Delivery at a
 * time and records what it answers; the kind never touches the ledger.
 */

import type { AppDb } from "@/db";
import type { Env } from "@/types";
import type { AttemptOutcome, ConsumerRow } from "../../../../cod-shared/events/deliveries";
import type { BusinessEvent } from "../../../../cod-shared/events/log";
import type { Cost } from "../meter";

export interface Attempt {
  /** The Delivery this Attempt is for: the same on every Attempt of it. */
  deliveryId: string;
  event: BusinessEvent;
  consumer: ConsumerRow;
  /** This Attempt's number, counting from 1. */
  attempt: number;
  /** The store's database and fetch, counted against the invocation's budget. */
  db: AppDb;
  fetch: typeof fetch;
  env: Env;
}

export interface ConsumerKind {
  /** As stored on `event_consumers.kind`. */
  kind: string;
  /** The most one Attempt may spend, so the drain never starts one it cannot finish. */
  cost: Cost;
  /**
   * Try to deliver. A thrown error is an Attempt to retry — return `reject`
   * for what will never succeed (a refused credential, a gone endpoint).
   */
  deliver(attempt: Attempt): Promise<AttemptOutcome>;
}

export type ConsumerKinds = Readonly<Record<string, ConsumerKind>>;
