/**
 * The webhook Kind against the Standard Webhooks specification: signatures
 * checked by the reference library's own vector and by an independent
 * verifier written on node:crypto, as a receiver would; every class of answer
 * mapped to its outcome; and the endpoint's time, the event's size and the
 * answer's length all bounded.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ConsumerRow } from "../../../../cod-shared/events/deliveries";
import type { BusinessEvent } from "../../../../cod-shared/events/log";
import { PREVIOUS_SECRET_SIGNS_FOR_MS } from "../../../../cod-shared/events/webhooks";
import { RETRY_AFTER_MAX_SECONDS, WEBHOOK_BODY_MAX_BYTES, retryAfterSeconds, sendWebhook, signWebhook, webhook } from "./webhook";

const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const OLD_SECRET = "whsec_bGVhdmluZy1zZWNyZXQtYnl0ZXMtMzItbG9uZw==";
const NOW = new Date("2026-10-25T10:00:00.250Z");
const URL_ = "https://hooks.example.dz/codflow";

/** A receiver's check, per the specification, sharing no code with the sender. */
function verify(secret: string, headers: Headers, body: string, now: Date): boolean {
  const id = headers.get("webhook-id")!;
  const timestamp = Number(headers.get("webhook-timestamp"));
  if (Math.abs(now.getTime() / 1000 - timestamp) > 300) return false;
  const expected = createHmac("sha256", Buffer.from(secret.slice("whsec_".length), "base64")).update(`${id}.${timestamp}.${body}`).digest();
  return headers
    .get("webhook-signature")!
    .split(" ")
    .some((entry) => {
      const [version, signature] = entry.split(",");
      const given = Buffer.from(signature ?? "", "base64");
      return version === "v1" && given.length === expected.length && timingSafeEqual(given, expected);
    });
}

interface Sent {
  url: string;
  init: RequestInit;
  headers: Headers;
  body: string;
}

function endpoint(answer: (sent: Sent) => Response | Promise<Response>) {
  const sent: Sent[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const request = { url, init, headers: new Headers(init.headers), body: String(init.body) };
    sent.push(request);
    return answer(request);
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, sent };
}

const send = (outbound: typeof fetch, over: Partial<Parameters<typeof sendWebhook>[0]> = {}, timeoutMs?: number) =>
  sendWebhook({ url: URL_, secrets: [SECRET], id: "evt_1", body: '{"type":"order.created"}', now: NOW, ...over }, outbound, timeoutMs);

describe("signing", () => {
  it("matches the reference library's vector", async () => {
    expect(await signWebhook([SECRET], "msg_p5jXN8AQM9LWM0D4loKWxJek", 1614265330, '{"test": 2432232314}')).toBe("v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=");
  });

  it("is verified by an independent receiver, over exactly the bytes sent", async () => {
    const { fetch, sent } = endpoint(() => new Response(null, { status: 204 }));
    const body = JSON.stringify({ type: "order.created", data: { order: { customer: { name: "أمينة" } } } });
    await send(fetch, { body });
    const [request] = sent;
    expect(request!.headers.get("webhook-id")).toBe("evt_1");
    expect(request!.headers.get("webhook-timestamp")).toBe(String(Math.floor(NOW.getTime() / 1000)));
    expect(request!.headers.get("content-type")).toBe("application/json");
    expect(request!.headers.get("user-agent")).toBe("CodFlow-Webhooks/1");
    expect(request!.body).toBe(body);
    expect(verify(SECRET, request!.headers, request!.body, NOW)).toBe(true);
    expect(verify(SECRET, request!.headers, body.replace("أمينة", "Amina"), NOW)).toBe(false);
    expect(verify(OLD_SECRET, request!.headers, request!.body, NOW)).toBe(false);
  });

  it("during a rotation, carries a signature each secret verifies on its own", async () => {
    const { fetch, sent } = endpoint(() => new Response("ok"));
    await send(fetch, { secrets: [SECRET, OLD_SECRET] });
    const [request] = sent;
    expect(request!.headers.get("webhook-signature")!.split(" ")).toHaveLength(2);
    expect(verify(SECRET, request!.headers, request!.body, NOW)).toBe(true);
    expect(verify(OLD_SECRET, request!.headers, request!.body, NOW)).toBe(true);
  });

  it("follows no redirect and waits no longer than its deadline", async () => {
    const { fetch, sent } = endpoint(() => new Response("ok"));
    await send(fetch);
    expect(sent[0]!.init.redirect).toBe("manual");
    expect(sent[0]!.init.signal).toBeInstanceOf(AbortSignal);
    expect(sent[0]!.init.method).toBe("POST");
  });
});

describe("what the endpoint answers decides the Attempt", () => {
  it.each([200, 201, 202, 204, 299])("%i: delivered", async (status) => {
    const { fetch } = endpoint(() => new Response(status === 204 ? null : "thanks", { status }));
    expect(await send(fetch)).toEqual({ kind: "delivered", httpStatus: status, ...(status === 204 ? {} : { response: "thanks" }) });
  });

  it("410: dead, and the Consumer stops as it asked", async () => {
    const { fetch } = endpoint(() => new Response("unsubscribed", { status: 410 }));
    expect(await send(fetch)).toEqual({ kind: "reject", consumerGone: true, httpStatus: 410, response: "unsubscribed", error: "The endpoint answered 410 Gone: it asks to receive nothing more" });
  });

  it.each([301, 302, 303, 307, 308])("%i: retried, the redirect not followed", async (status) => {
    const { fetch, sent } = endpoint(() => new Response(null, { status, headers: { location: "https://new.example.dz/hook" } }));
    expect(await send(fetch)).toEqual({ kind: "retry", httpStatus: status, error: `The endpoint redirected (HTTP ${status} to https://new.example.dz/hook); redirects are not followed — save the URL it points to` });
    expect(sent).toHaveLength(1);
  });

  it.each([400, 401, 403, 404, 408, 409, 413, 422, 500, 501, 502, 504])("%i: retried", async (status) => {
    const { fetch } = endpoint(() => new Response(`{"error":"no"}`, { status }));
    expect(await send(fetch)).toEqual({ kind: "retry", httpStatus: status, response: `{"error":"no"}`, error: `HTTP ${status}` });
  });

  it("429 with Retry-After in seconds: retried no sooner than asked", async () => {
    const { fetch } = endpoint(() => new Response(null, { status: 429, headers: { "retry-after": "7200" } }));
    expect(await send(fetch)).toEqual({ kind: "retry", httpStatus: 429, error: "HTTP 429", retryAfterSeconds: 7200 });
  });

  it("503 with Retry-After as a date: retried no sooner than that date", async () => {
    const { fetch } = endpoint(() => new Response(null, { status: 503, headers: { "retry-after": "Sun, 25 Oct 2026 11:00:00 GMT" } }));
    expect(await send(fetch)).toEqual({ kind: "retry", httpStatus: 503, error: "HTTP 503", retryAfterSeconds: 3600 });
  });

  it("no answer within the deadline: retried", async () => {
    const neverAnswers = vi.fn(
      (_url: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal!.reason))),
    );
    expect(await send(neverAnswers as unknown as typeof fetch, {}, 20)).toEqual({ kind: "retry", error: "No answer within 0.02 s" });
  });

  it("no connection (a name that does not resolve): retried", async () => {
    const unreachable = vi.fn(async () => {
      throw new TypeError("getaddrinfo ENOTFOUND hooks.example.dz");
    });
    expect(await send(unreachable as unknown as typeof fetch)).toEqual({ kind: "retry", error: "The endpoint could not be reached: getaddrinfo ENOTFOUND hooks.example.dz" });
  });
});

describe("Retry-After", () => {
  it.each([
    ["120", 120],
    [" 5 ", 5],
    ["Sun, 25 Oct 2026 10:00:10 GMT", 10],
    [String(RETRY_AFTER_MAX_SECONDS + 1), RETRY_AFTER_MAX_SECONDS],
    ["Mon, 01 Jan 2035 00:00:00 GMT", RETRY_AFTER_MAX_SECONDS],
  ])("%s asks for %i s", (header, seconds) => {
    expect(retryAfterSeconds(header, NOW)).toBe(seconds);
  });

  it.each([null, "", "0", "-5", "soon", "Sat, 24 Oct 2026 10:00:00 GMT", "1.5"])("%s asks for no wait", (header) => {
    expect(retryAfterSeconds(header, NOW)).toBeUndefined();
  });
});

describe("what is never sent", () => {
  it.each(["http://hooks.example.dz/", "https://127.0.0.1/hook", "https://169.254.169.254/latest/meta-data"])("an event to %s: dead, nothing sent", async (url) => {
    const { fetch, sent } = endpoint(() => new Response("ok"));
    const outcome = await send(fetch, { url });
    expect(outcome.kind).toBe("reject");
    expect(outcome).not.toHaveProperty("consumerGone");
    expect(sent).toEqual([]);
  });

  it("an event larger than 64 KB: dead, nothing sent; exactly 64 KB is sent", async () => {
    const { fetch, sent } = endpoint(() => new Response("ok"));
    const sized = (bytes: number) => `"${"é".repeat((bytes - 2) / 2)}"`;
    expect(await send(fetch, { body: sized(WEBHOOK_BODY_MAX_BYTES + 2) })).toEqual({ kind: "reject", error: `The event is ${WEBHOOK_BODY_MAX_BYTES + 2} bytes, more than the ${WEBHOOK_BODY_MAX_BYTES} a webhook carries` });
    expect(sent).toEqual([]);
    expect((await send(fetch, { body: sized(WEBHOOK_BODY_MAX_BYTES) })).kind).toBe("delivered");
  });
});

describe("the answer", () => {
  it("is read only as far as its excerpt, however long it runs", async () => {
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 1000) return controller.close();
        controller.enqueue(new TextEncoder().encode("x".repeat(1024)));
      },
    });
    const { fetch } = endpoint(() => new Response(endless, { status: 200 }));
    const outcome = await send(fetch);
    expect(outcome.kind).toBe("delivered");
    expect((outcome as { response: string }).response).toHaveLength(4096);
    expect(pulled).toBeLessThan(10);
  });

  it("cut off midway still settles by its status, with what arrived", async () => {
    let sentOnce = false;
    const broken = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sentOnce) return controller.error(new Error("connection reset"));
        sentOnce = true;
        controller.enqueue(new TextEncoder().encode("partial"));
      },
    });
    const { fetch } = endpoint(() => new Response(broken, { status: 500 }));
    expect(await send(fetch)).toEqual({ kind: "retry", httpStatus: 500, response: "partial", error: "HTTP 500" });
  });
});

describe("the Kind", () => {
  const event = { id: "evt_42", type: "order.created", sequence: 42 } as unknown as BusinessEvent;
  const consumer = (over: Partial<ConsumerRow>): ConsumerRow =>
    ({ id: "hook", kind: "webhook", settings: JSON.stringify({ url: URL_ }), signingSecret: SECRET, previousSigningSecret: null, secretRotatedAt: null, ...over }) as ConsumerRow;
  const attempt = (row: ConsumerRow, fetch: typeof globalThis.fetch, now = NOW) =>
    webhook.deliver({ deliveryId: "d1", event, consumer: row, attempt: 1, now, db: null as never, fetch, env: null as never });

  it("sends the event as published to the Consumer's URL, by its id", async () => {
    const { fetch, sent } = endpoint(() => new Response("ok"));
    expect((await attempt(consumer({}), fetch)).kind).toBe("delivered");
    expect(sent[0]!.url).toBe(URL_);
    expect(sent[0]!.headers.get("webhook-id")).toBe("evt_42");
    expect(JSON.parse(sent[0]!.body)).toEqual(event);
  });

  it("signs with the previous secret too, only for a day after a rotation", async () => {
    const rotated = consumer({ previousSigningSecret: OLD_SECRET, secretRotatedAt: NOW.toISOString() });
    const { fetch, sent } = endpoint(() => new Response("ok"));
    await attempt(rotated, fetch, new Date(NOW.getTime() + PREVIOUS_SECRET_SIGNS_FOR_MS - 1000));
    await attempt(rotated, fetch, new Date(NOW.getTime() + PREVIOUS_SECRET_SIGNS_FOR_MS));
    const later = new Date(NOW.getTime() + PREVIOUS_SECRET_SIGNS_FOR_MS);
    expect(verify(OLD_SECRET, sent[0]!.headers, sent[0]!.body, new Date(later.getTime() - 1000))).toBe(true);
    expect(verify(OLD_SECRET, sent[1]!.headers, sent[1]!.body, later)).toBe(false);
    expect(verify(SECRET, sent[1]!.headers, sent[1]!.body, later)).toBe(true);
  });
});
