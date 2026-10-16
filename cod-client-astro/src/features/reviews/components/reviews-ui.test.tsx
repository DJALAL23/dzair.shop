// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reviewsApi = vi.hoisted(() => ({
  createStoreReview: vi.fn(),
  listReviewOrderOptions: vi.fn(),
  uploadReviewFile: vi.fn(),
}));
const productsApi = vi.hoisted(() => ({ listProducts: vi.fn() }));
const customersApi = vi.hoisted(() => ({ listCustomers: vi.fn() }));
vi.mock("@/features/reviews/api", () => reviewsApi);
vi.mock("@/features/products/api", () => productsApi);
vi.mock("@/features/customers/api", () => customersApi);

import { ReviewCard } from "./ReviewCard";
import { AddReviewDialog } from "./AddReviewDialog";
import type { Review } from "@/features/reviews/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.localStorage.setItem("locale", "en");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  for (const fn of [...Object.values(reviewsApi), ...Object.values(productsApi), ...Object.values(customersApi)]) fn.mockReset();
  productsApi.listProducts.mockResolvedValue({ data: [{ id: "p1", name: "Robe", sku: "ROBE" }] });
  customersApi.listCustomers.mockResolvedValue({ data: [{ id: "c1", name: "Karim Benali", phone: "0551234567" }] });
  reviewsApi.listReviewOrderOptions.mockResolvedValue([
    { id: "oD", orderNumber: "ORD-1", createdAt: "x", delivered: true, reviewed: false },
    { id: "oR", orderNumber: "ORD-2", createdAt: "x", delivered: true, reviewed: true },
  ]);
  reviewsApi.createStoreReview.mockResolvedValue({ id: "r1", status: "approved", verified: true, review: null });
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  host.remove();
  document.body.innerHTML = "";
});

const review: Review = {
  id: "r1", productId: "p1", productName: "Robe", orderId: "o1", orderNumber: "ORD-20261016-1111", customerId: "c1", customerName: "Karim",
  rating: 4, title: "Très bien", body: "Belle robe, bonne taille.", status: "pending", source: "storefront", verified: true, mediaDropped: 1,
  createdBy: null, createdAt: "2026-10-16T10:00:00.000Z", updatedAt: "2026-10-16T10:00:00.000Z",
  media: [
    { id: "m1", kind: "image", url: "https://m/full.webp", thumbUrl: "https://m/thumb.webp", contentType: "image/webp", bytes: 9, width: 1600, height: 1200, durationMs: null },
    { id: "m2", kind: "audio", url: "https://m/voice.ogg", thumbUrl: null, contentType: "audio/ogg", bytes: 9, width: null, height: null, durationMs: 21_000 },
  ],
};

const text = () => document.body.textContent ?? "";

describe("a review card", () => {
  it("shows the verified badge, the photos small, and a voice note that loads only when played", () => {
    act(() => root.render(<ReviewCard review={review} actions={null} />));
    expect(text()).toContain("Verified purchase");
    expect(text()).not.toContain("Added by the store");
    const thumb = host.querySelector("img")!;
    expect(thumb.getAttribute("src")).toBe("https://m/thumb.webp");
    expect(thumb.getAttribute("loading")).toBe("lazy");
    const audio = host.querySelector("audio")!;
    expect(audio.getAttribute("preload")).toBe("none");
    expect(text()).toContain("0:21");
    expect(text()).toContain("1 file sent with it could not be kept");
    expect(host.querySelector('a[href="/orders/o1"]')?.textContent).toBe("ORD-20261016-1111");
  });

  it("says when the store entered it, and offers no decisions to who may not moderate", () => {
    act(() => root.render(<ReviewCard review={{ ...review, source: "merchant", verified: false, orderId: null, orderNumber: null }} actions={null} />));
    expect(text()).toContain("Added by the store");
    expect(text()).not.toContain("Verified purchase");
    expect(text()).not.toContain("Approve");
  });

  it("puts approval at hand for a pending review", () => {
    const onStatus = vi.fn();
    act(() => root.render(<ReviewCard review={review} actions={{ busy: false, onStatus, onDelete: vi.fn(), onRemoveMedia: vi.fn() }} />));
    const approve = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("Approve"))!;
    act(() => approve.click());
    expect(onStatus).toHaveBeenCalledWith("approved");
  });
});

function typeInto(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function flush() {
  await act(async () => {
    vi.runAllTimers();
    await Promise.resolve();
    await Promise.resolve();
  });
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
const save = () => Array.from(dialog().querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === "Add review")!;
const pickers = () => Array.from(dialog().querySelectorAll<HTMLInputElement>('input[role="combobox"]'));

async function choose(picker: HTMLInputElement, query: string, label: string) {
  act(() => picker.focus());
  typeInto(picker, query);
  await flush();
  const option = Array.from(dialog().querySelectorAll<HTMLButtonElement>('[role="option"] button')).find((b) => b.textContent?.includes(label))!;
  act(() => option.click());
  await flush();
}

describe("adding a review the store received", () => {
  it("needs a product, a name and a few words, then saves it on a delivered order as verified", async () => {
    const onCreated = vi.fn();
    act(() => root.render(<AddReviewDialog onClose={vi.fn()} onCreated={onCreated} />));
    expect(save().disabled).toBe(true);

    await choose(pickers()[0], "rob", "Robe");
    await choose(pickers()[0], "kar", "Karim Benali");
    expect((dialog().querySelector('input[placeholder="Karim Benali"]') as HTMLInputElement).value).toBe("Karim Benali");
    expect(reviewsApi.listReviewOrderOptions).toHaveBeenCalledWith("c1", "p1");
    expect(text()).toContain("ORD-2 · already reviewed");

    const textarea = dialog().querySelector("textarea")!;
    typeInto(textarea, "Top");
    expect(save().disabled).toBe(true);
    typeInto(textarea, "Reçu par WhatsApp, très contente");
    expect(save().disabled).toBe(false);

    await act(async () => {
      dialog().querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(reviewsApi.createStoreReview).toHaveBeenCalledWith({
      productId: "p1", customerId: "c1", customerName: "Karim Benali", orderId: null, rating: 5, title: null, body: "Reçu par WhatsApp, très contente", uploads: [], publish: true,
    });
    expect(onCreated).toHaveBeenCalled();
  });

  it("takes a voice note instead of words, and waits for every file to arrive", async () => {
    let finish!: (value: unknown) => void;
    reviewsApi.uploadReviewFile.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    act(() => root.render(<AddReviewDialog onClose={vi.fn()} onCreated={vi.fn()} />));
    await choose(pickers()[0], "rob", "Robe");
    typeInto(dialog().querySelector<HTMLInputElement>('input[placeholder="e.g. Karim B."]')!, "Mme Yasmine");

    const input = dialog().querySelector<HTMLInputElement>('input[type="file"]')!;
    const voice = new File([new Uint8Array([0x4f, 0x67, 0x67, 0x53])], "PTT-2026.opus", { type: "audio/ogg" });
    Object.defineProperty(input, "files", { value: [voice], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    expect(save().disabled).toBe(true);
    await act(async () => {
      vi.runAllTimers();
      finish({ uploadId: "u".repeat(32), kind: "audio", bytes: 4 });
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();
    expect(save().disabled).toBe(false);
  });

  it("never saves while a photo is still on its way", async () => {
    let finish!: (value: unknown) => void;
    reviewsApi.uploadReviewFile.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    act(() => root.render(<AddReviewDialog onClose={vi.fn()} onCreated={vi.fn()} />));
    await choose(pickers()[0], "rob", "Robe");
    typeInto(dialog().querySelector<HTMLInputElement>('input[placeholder="e.g. Karim B."]')!, "Mme Yasmine");
    typeInto(dialog().querySelector("textarea")!, "Très belle qualité, merci");
    expect(save().disabled).toBe(false);

    const input = dialog().querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { value: [new File([new Uint8Array([0xff, 0xd8, 0xff])], "photo.jpg", { type: "image/jpeg" })], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    expect(save().disabled).toBe(true);
    await act(async () => {
      finish({ uploadId: "p".repeat(32), kind: "image", bytes: 3 });
      await Promise.resolve();
    });
    await flush();
    expect(save().disabled).toBe(false);
  });
});
