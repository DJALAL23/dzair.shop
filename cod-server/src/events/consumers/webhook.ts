/**
 * Webhooks as a Consumer Kind (plan, Phase 11): a Business Event POSTed to
 * the merchant's own endpoint as JSON, signed per the Standard Webhooks
 * specification.
 *
 *   webhook-id         the event's id — the same on every Attempt and every
 *                      Replay, so the receiver recognises what it already has
 *   webhook-timestamp  the Attempt's time, in Unix seconds
 *   webhook-signature  `v1,` + base64 HMAC-SHA256 of `id.timestamp.body`, one
 *                      per Signing Secret that signs now, space-separated
 *
 * What the endpoint answers decides the Attempt: 2xx delivered; 410 Gone
 * dead, and the Consumer stopped as it asked; anything else — a redirect
 * (never followed), any other status, no answer within the timeout, no
 * connection — is retried on the delivery schedule, no sooner than a
 * Retry-After asked.
 */

import type { AttemptOutcome, ConsumerRow } from "../../../../cod-shared/events/deliveries";
import type { EventType } from "../../../../cod-shared/events/catalogue";
import { WEBHOOK_KIND, readWebhookSettings, signingKey, signingSecretsAt, webhookUrlProblem } from "../../../../cod-shared/events/webhooks";
import { exampleEvent } from "../examples";
import type { ConsumerKind } from "./kind";

/** How long an endpoint has to answer an Attempt. */
export const WEBHOOK_TIMEOUT_MS = 15_000;
/** The largest event a webhook carries. */
export const WEBHOOK_BODY_MAX_BYTES = 64 * 1024;
/** The longest wait a Retry-After can ask for; the delivery schedule's longest. */
export const RETRY_AFTER_MAX_SECONDS = 24 * 60 * 60;
/** How much of an answer is read, for the Attempt's excerpt. */
const ANSWER_READ_BYTES = 4096;
const USER_AGENT = "CodFlow-Webhooks/1";

const encoder = new TextEncoder();

/** The `webhook-signature` header: one `v1,` signature per secret, space-separated. */
export async function signWebhook(secrets: readonly string[], id: string, timestamp: number, body: string): Promise<string> {
  const content = encoder.encode(`${id}.${timestamp}.${body}`);
  const signatures = await Promise.all(
    secrets.map(async (secret) => {
      const key = await crypto.subtle.importKey("raw", signingKey(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, content));
      return `v1,${btoa(String.fromCharCode(...mac))}`;
    }),
  );
  return signatures.join(" ");
}

/** A Retry-After header's wait in whole seconds (delay or date), at most `RETRY_AFTER_MAX_SECONDS`; undefined when it asks for none. */
export function retryAfterSeconds(header: string | null, now: Date): number | undefined {
  if (!header) return undefined;
  const value = header.trim();
  const seconds = /^\d+$/.test(value) ? Number(value) : (Date.parse(value) - now.getTime()) / 1000;
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return Math.min(Math.ceil(seconds), RETRY_AFTER_MAX_SECONDS);
}

/** The start of what the endpoint answered; what arrives before the answer is cut off is kept. */
async function answerExcerpt(response: Response): Promise<string | undefined> {
  if (!response.body) return undefined;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < ANSWER_READ_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
    }
    await reader.cancel();
  } catch {
    // The answer stopped arriving; its status has already decided the Attempt.
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes.subarray(0, ANSWER_READ_BYTES)).trim();
  return text || undefined;
}

export interface WebhookRequest {
  url: string;
  /** The Signing Secrets that sign now, the current one first. */
  secrets: readonly string[];
  /** The `webhook-id`: the event's id. */
  id: string;
  body: string;
  now: Date;
}

/** What sending to an endpoint can come to: it is never skipped. */
export type WebhookOutcome = Exclude<AttemptOutcome, { kind: "skipped" }>;

/** POST one signed event to an endpoint, and say what came of it. */
export async function sendWebhook(request: WebhookRequest, outbound: typeof fetch, timeoutMs = WEBHOOK_TIMEOUT_MS): Promise<WebhookOutcome> {
  const problem = webhookUrlProblem(request.url);
  if (problem) return { kind: "reject", error: `The endpoint's URL is refused (${problem}): use a public https URL` };
  const size = encoder.encode(request.body).byteLength;
  if (size > WEBHOOK_BODY_MAX_BYTES) return { kind: "reject", error: `The event is ${size} bytes, more than the ${WEBHOOK_BODY_MAX_BYTES} a webhook carries` };

  const timestamp = Math.floor(request.now.getTime() / 1000);
  let response: Response;
  try {
    response = await outbound(request.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": USER_AGENT,
        "webhook-id": request.id,
        "webhook-timestamp": String(timestamp),
        "webhook-signature": await signWebhook(request.secrets, request.id, timestamp, request.body),
      },
      body: request.body,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if ((error as { name?: unknown } | null)?.name === "TimeoutError") return { kind: "retry", error: `No answer within ${timeoutMs / 1000} s` };
    return { kind: "retry", error: `The endpoint could not be reached: ${(error as Error)?.message ?? String(error)}` };
  }

  const httpStatus = response.status;
  const answer = await answerExcerpt(response);
  const detail = { httpStatus, ...(answer === undefined ? {} : { response: answer }) };
  if (httpStatus >= 200 && httpStatus < 300) return { kind: "delivered", ...detail };
  if (httpStatus === 410) return { kind: "reject", consumerGone: true, error: "The endpoint answered 410 Gone: it asks to receive nothing more", ...detail };
  if (httpStatus >= 300 && httpStatus < 400) {
    const location = response.headers.get("location");
    return { kind: "retry", error: `The endpoint redirected (HTTP ${httpStatus}${location ? ` to ${location}` : ""}); redirects are not followed — save the URL it points to`, ...detail };
  }
  const wait = retryAfterSeconds(response.headers.get("retry-after"), request.now);
  return { kind: "retry", error: `HTTP ${httpStatus}`, ...detail, ...(wait === undefined ? {} : { retryAfterSeconds: wait }) };
}

export const webhook: ConsumerKind = {
  kind: WEBHOOK_KIND,
  cost: { external: 1, services: 0 },

  async deliver({ event, consumer, fetch, now }) {
    const { url } = readWebhookSettings(consumer.settings);
    return sendWebhook({ url, secrets: signingSecretsAt(consumer, now), id: event.id, body: JSON.stringify(event), now }, fetch);
  },
};

/** What a Test Event came to: the Attempt it would have been, recorded nowhere. */
export interface WebhookTest {
  event: { id: string; type: EventType };
  outcome: WebhookOutcome["kind"];
  httpStatus: number | null;
  durationMs: number;
  response: string | null;
  error: string | null;
}

/**
 * Send a Test Event to a webhook Consumer, at once: an example of `type`,
 * signed like any Delivery, with Sequence 0 and an id starting `test_` so an
 * endpoint can tell it from the store's Business Events — it is in no Event
 * Log and has no Delivery.
 */
export async function sendTestEvent(consumer: ConsumerRow, type: EventType, outbound: typeof fetch, now: Date): Promise<WebhookTest> {
  const id = `test_${crypto.randomUUID()}`;
  const event = { ...exampleEvent(type), id, sequence: 0, occurredAt: now.toISOString(), recordedAt: now.toISOString() };
  const started = Date.now();
  const outcome = await sendWebhook({ url: readWebhookSettings(consumer.settings).url, secrets: signingSecretsAt(consumer, now), id, body: JSON.stringify(event), now }, outbound);
  return {
    event: { id, type },
    outcome: outcome.kind,
    httpStatus: outcome.httpStatus ?? null,
    durationMs: Date.now() - started,
    response: outcome.response ?? null,
    error: outcome.kind === "delivered" ? null : outcome.error,
  };
}
