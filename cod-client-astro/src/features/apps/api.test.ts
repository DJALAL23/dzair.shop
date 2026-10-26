import { beforeEach, describe, expect, it, vi } from "vitest";

const seam = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: seam.apiFetch }));

import { listApps, removeApp } from "./api";
import { getMetaApp, metaSwitches, saveMetaApp } from "./meta/api";
import { getDZVerifyApp, saveDZVerifyApp, testDZVerifyKey } from "./dzverify/api";
import { getTurnstileApp, saveTurnstileApp } from "./turnstile/api";
import { getSendiliApp, saveSendiliApp, testSendiliKey } from "./sendili/api";
import { getWhatsAppButtonApp, saveWhatsAppButtonApp } from "./whatsapp-button/api";
import { changeTelegramApp, getTelegramApp, openTelegramPairing, saveTelegramBot, sendTelegramTest } from "./telegram/api";

const put = (body: unknown) => expect.objectContaining({ method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const post = (body: unknown) => expect.objectContaining({ method: "POST", body: JSON.stringify(body) });

describe("the Apps API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists the Apps with their status and removes one by its key", async () => {
    const apps = [{ key: "meta", category: "marketing", status: "on" }];
    seam.apiFetch.mockResolvedValue({ success: true, data: apps });
    await expect(listApps()).resolves.toEqual(apps);
    expect(seam.apiFetch).toHaveBeenCalledWith("/api/apps");

    seam.apiFetch.mockResolvedValue({ success: true, message: "App removed" });
    await expect(removeApp("whatsapp-button")).resolves.toEqual({ updatesStopped: true });
    expect(seam.apiFetch).toHaveBeenCalledWith("/api/apps/whatsapp-button", { method: "DELETE" });

    seam.apiFetch.mockResolvedValue({ success: true, data: { updatesStopped: false, error: "Telegram answered 401: Unauthorized" } });
    await expect(removeApp("telegram")).resolves.toEqual({ updatesStopped: false });
  });

  it("reads the Meta App (null before it is set up) and saves it with PUT", async () => {
    seam.apiFetch.mockResolvedValue({ success: true, data: null });
    await expect(getMetaApp()).resolves.toBeNull();
    expect(seam.apiFetch).toHaveBeenCalledWith("/api/apps/meta");

    const setup = { id: "px1", pixelId: "123", accessTokenMasked: "••••EAAG", conversionEvent: "Purchase" };
    seam.apiFetch.mockResolvedValue({ success: true, data: setup });
    await expect(saveMetaApp({ pixelId: "123", accessToken: "EAAG", conversionEvent: "Purchase", enabled: true })).resolves.toEqual(setup);
    expect(seam.apiFetch).toHaveBeenCalledWith("/api/apps/meta", put({ pixelId: "123", accessToken: "EAAG", conversionEvent: "Purchase", enabled: true }));
  });

  it("gives a landing page the Meta App's switches, asking nothing for a member who may not see the App", async () => {
    await expect(metaSwitches(false)).resolves.toBeNull();
    expect(seam.apiFetch).not.toHaveBeenCalled();

    seam.apiFetch.mockResolvedValue({ success: true, data: { pixelId: "1", enabled: true, perPageTrackingEnabled: false, accessTokenMasked: "••••" } });
    await expect(metaSwitches(true)).resolves.toEqual({ enabled: true, perPageTrackingEnabled: false });
    expect(seam.apiFetch).toHaveBeenCalledWith("/api/apps/meta");

    seam.apiFetch.mockResolvedValue({ success: true, data: null });
    await expect(metaSwitches(true)).resolves.toBeNull();
  });

  it("reads, saves and tests the DZVerify App, sending a key to test only when one is typed", async () => {
    seam.apiFetch.mockResolvedValue({ success: true, data: null });
    await expect(getDZVerifyApp()).resolves.toBeNull();
    expect(seam.apiFetch).toHaveBeenCalledWith("/api/apps/dzverify");

    seam.apiFetch.mockResolvedValue({ success: true, data: { enabled: true } });
    await saveDZVerifyApp({ apiKey: "dzv_1", language: "fr", enabled: true });
    expect(seam.apiFetch).toHaveBeenCalledWith("/api/apps/dzverify", put({ apiKey: "dzv_1", language: "fr", enabled: true }));

    seam.apiFetch.mockResolvedValue({ success: true, data: { ok: true } });
    await expect(testDZVerifyKey()).resolves.toEqual({ ok: true });
    expect(seam.apiFetch).toHaveBeenCalledWith("/api/apps/dzverify/test", post({}));
    await testDZVerifyKey("dzv_typed");
    expect(seam.apiFetch).toHaveBeenCalledWith("/api/apps/dzverify/test", post({ apiKey: "dzv_typed" }));
  });

  it("reads the Turnstile App (null before it is set up) and saves it with PUT", async () => {
    seam.apiFetch.mockResolvedValue({ success: true, data: null });
    await expect(getTurnstileApp()).resolves.toBeNull();
    expect(seam.apiFetch).toHaveBeenCalledWith("/api/apps/turnstile");

    const setup = { siteKey: "0x4AAA-site", enabled: true, secretKeyMasked: "••••cret", createdAt: "t", updatedAt: "t2" };
    seam.apiFetch.mockResolvedValue({ success: true, data: setup });
    await expect(saveTurnstileApp({ siteKey: "0x4AAA-site", secretKey: "0x4AAA-secret", enabled: true })).resolves.toEqual(setup);
    expect(seam.apiFetch).toHaveBeenCalledWith("/api/apps/turnstile", put({ siteKey: "0x4AAA-site", secretKey: "0x4AAA-secret", enabled: true }));
  });

  it("reads, saves and tests the Sendili App", async () => {
    seam.apiFetch.mockResolvedValue({ success: true, data: null });
    await expect(getSendiliApp()).resolves.toBeNull();
    expect(seam.apiFetch).toHaveBeenCalledWith("/api/apps/sendili");

    const setup = { fromEmail: "noreply@acme.com", fromName: "Acme", enabled: true, apiKeyMasked: "••••a9f2", createdAt: "t", updatedAt: "t" };
    seam.apiFetch.mockResolvedValue({ success: true, data: setup });
    await expect(saveSendiliApp({ apiKey: "sk_live_new", fromEmail: "noreply@acme.com", fromName: "Acme", enabled: true })).resolves.toEqual(setup);
    expect(seam.apiFetch).toHaveBeenCalledWith("/api/apps/sendili", put({ apiKey: "sk_live_new", fromEmail: "noreply@acme.com", fromName: "Acme", enabled: true }));

    seam.apiFetch.mockResolvedValue({ success: true, data: { ok: true, domains: ["acme.com"] } });
    await expect(testSendiliKey()).resolves.toEqual({ ok: true, domains: ["acme.com"] });
    expect(seam.apiFetch).toHaveBeenCalledWith("/api/apps/sendili/test", post({}));
    await testSendiliKey("sk_live_maybe");
    expect(seam.apiFetch).toHaveBeenCalledWith("/api/apps/sendili/test", post({ apiKey: "sk_live_maybe" }));
  });

  it("reads and saves the WhatsApp button App", async () => {
    const response = { config: { enabled: true }, preview: null, capabilities: {} };
    seam.apiFetch.mockResolvedValue({ success: true, data: response });
    await expect(getWhatsAppButtonApp()).resolves.toEqual(response);
    expect(seam.apiFetch).toHaveBeenCalledWith("/api/apps/whatsapp-button");

    await expect(saveWhatsAppButtonApp({ enabled: false })).resolves.toEqual(response);
    expect(seam.apiFetch).toHaveBeenCalledWith("/api/apps/whatsapp-button", put({ enabled: false }));
  });

  it("reads the Telegram App, saves its bot, opens a pairing link, tests and changes it", async () => {
    seam.apiFetch.mockResolvedValue({ success: true, data: null });
    await expect(getTelegramApp()).resolves.toBeNull();
    expect(seam.apiFetch).toHaveBeenCalledWith("/api/apps/telegram");

    await saveTelegramBot("123:AAtoken");
    expect(seam.apiFetch).toHaveBeenCalledWith("/api/apps/telegram/bot", put({ token: "123:AAtoken" }));
    await openTelegramPairing();
    expect(seam.apiFetch).toHaveBeenCalledWith("/api/apps/telegram/pairing", post({}));
    await sendTelegramTest();
    expect(seam.apiFetch).toHaveBeenCalledWith("/api/apps/telegram/test", post({}));
    await changeTelegramApp({ events: ["order.created"], language: null });
    expect(seam.apiFetch).toHaveBeenCalledWith("/api/apps/telegram", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ events: ["order.created"], language: null }) }));
  });
});
