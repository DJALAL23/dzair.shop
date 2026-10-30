// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductImage, ProductVariant } from "@/features/products/types";

const server = vi.hoisted(() => ({
  images: [] as ProductImage[],
  variants: [] as ProductVariant[],
  product: {} as Record<string, unknown>,
  nextId: 1,
}));

const api = vi.hoisted(() => ({
  createProduct: vi.fn(),
  createVariant: vi.fn(),
  deleteProductImage: vi.fn(),
  deleteVariant: vi.fn(),
  getProduct: vi.fn(),
  listProductGroups: vi.fn(),
  listProductImages: vi.fn(),
  listShippingProfiles: vi.fn(),
  listVariants: vi.fn(),
  reorderProductImages: vi.fn(),
  saveProductImage: vi.fn(),
  updateProduct: vi.fn(),
  updateVariant: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn(), ApiError: class ApiError extends Error {} }));
vi.mock("@/features/products/api", () => api);
vi.mock("@/features/collections/api", () => ({ listCollections: vi.fn(async () => []) }));
vi.mock("@/features/auth/components/RequireAuth", () => ({
  useIdentity: () => ({ role: "admin", scopes: [] }),
  canScope: () => true,
}));
vi.mock("@/features/uploads/useImageUpload", () => ({
  useImageUpload: () => ({
    progress: null,
    upload: async (file: File) => ({ key: `products/${file.name}`, url: `https://cdn.test/products/${file.name}` }),
  }),
}));

import { ConfirmDialogProvider } from "@/components/ui";
import { ProductForm } from "./ProductForm";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PRODUCT_ID = "prod-1";

function image(id: string, position: number): ProductImage {
  return {
    id,
    productId: PRODUCT_ID,
    key: `products/${id}.webp`,
    url: `https://cdn.test/products/${id}.webp`,
    width: null,
    height: null,
    position,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

const ordered = () => [...server.images].sort((a, b) => a.position - b.position);

function serverRejects(status: number, code: string, fields: Array<{ path: string; message: string }> = []) {
  return Object.assign(new Error(code), { status, code, context: { fields } });
}

let host: HTMLDivElement;
let root: Root;
let assign: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.localStorage.setItem("locale", "en");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  for (const fn of Object.values(api)) fn.mockReset();
  server.images = [];
  server.variants = [];
  server.nextId = 1;
  server.product = {
    id: PRODUCT_ID,
    name: "Kaftan",
    handle: "kaftan",
    sku: "KAF-1",
    price: 4500,
    status: "ACTIVE",
    trackInventory: true,
    showInStore: true,
    hasVariants: false,
    inventory: 3,
    lowStockThreshold: 5,
    collectionIds: [],
  };

  api.getProduct.mockImplementation(async () => server.product);
  api.listVariants.mockImplementation(async () => [...server.variants]);
  api.createVariant.mockImplementation(async (_id: string, body: Partial<ProductVariant>) => {
    if (server.variants.some((variant) => variant.sku === body.sku))
      throw serverRejects(409, "DUPLICATE_SKU");
    const created = { ...body, id: `variant-${server.nextId++}`, productId: PRODUCT_ID } as ProductVariant;
    server.variants.push(created);
    return { data: created };
  });
  api.updateVariant.mockImplementation(async (_id: string, variantId: string, body: Partial<ProductVariant>) => {
    const variant = server.variants.find((item) => item.id === variantId);
    if (!variant) throw serverRejects(404, "VARIANT_NOT_FOUND");
    Object.assign(variant, body);
    return { data: variant };
  });
  api.listProductGroups.mockResolvedValue([]);
  api.listShippingProfiles.mockResolvedValue([]);
  api.updateProduct.mockResolvedValue({ data: { id: PRODUCT_ID } });
  api.listProductImages.mockImplementation(async () => ordered());
  api.saveProductImage.mockImplementation(async (_id: string, body: { mediaKey: string; position?: number }) => {
    if (body.position !== undefined && (!Number.isInteger(body.position) || body.position < 1))
      throw serverRejects(400, "VALIDATION_FAILED", [{ path: "position", message: "Too small: expected number to be >=1" }]);
    const position = body.position ?? Math.max(0, ...server.images.map((img) => img.position)) + 1;
    const saved = { ...image(`saved-${server.nextId++}`, position), key: body.mediaKey, url: `https://cdn.test/${body.mediaKey}` };
    server.images.push(saved);
    return { data: saved };
  });
  api.deleteProductImage.mockImplementation(async (_id: string, imageId: string) => {
    if (!server.images.some((img) => img.id === imageId)) throw serverRejects(404, "NOT_FOUND");
    server.images = server.images.filter((img) => img.id !== imageId);
    return { data: null };
  });
  api.reorderProductImages.mockImplementation(async (_id: string, imageIds: string[]) => {
    const known = new Set(server.images.map((img) => img.id));
    if (imageIds.length !== known.size || imageIds.some((id) => !known.has(id)))
      throw serverRejects(422, "VALIDATION_FAILED");
    imageIds.forEach((id, index) => {
      server.images.find((img) => img.id === id)!.position = index + 1;
    });
    return { data: ordered() };
  });

  assign = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, assign, pathname: `/products/${PRODUCT_ID}/edit` },
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
}

async function mountEditor() {
  await act(async () => {
    root.render(
      <ConfirmDialogProvider>
        <ProductForm productId={PRODUCT_ID} />
      </ConfirmDialogProvider>,
    );
  });
  await settle();
}

const tiles = () =>
  Array.from(host.querySelectorAll<HTMLImageElement>(".aspect-square img")).map((img) => img.getAttribute("src"));

const tileButton = (index: number, label: string) =>
  host.querySelectorAll(".aspect-square")[index].querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

async function click(button: HTMLButtonElement) {
  await act(async () => { button.click(); });
  await settle();
}

async function addImage(name: string) {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File([new Uint8Array(16)], name, { type: "image/png" });
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  await settle();
}

const saveButton = () =>
  Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) => /^Save$|^Saving/.test(b.textContent?.trim() ?? ""))!;

async function save() {
  await click(saveButton());
}

const savedSources = () => ordered().map((img) => img.url);
const alertText = () => host.querySelector('[role="alert"]')?.textContent ?? "";

describe("editing a product's images saves exactly what the merchant sees", () => {
  it("replaces the only image: a new one added, the old one removed", async () => {
    server.images = [image("old", 1)];
    await mountEditor();

    await addImage("new.png");
    await click(tileButton(0, "Remove"));
    expect(tiles()).toEqual(["https://cdn.test/products/new.png"]);
    await save();

    expect(alertText()).toBe("");
    expect(savedSources()).toEqual(["https://cdn.test/products/new.png"]);
    expect(assign).toHaveBeenCalledWith("/products");
  });

  it("keeps every position at 1 or more when several images are removed and added", async () => {
    server.images = [image("a", 1), image("b", 2), image("c", 3)];
    await mountEditor();

    await click(tileButton(0, "Remove"));
    await click(tileButton(0, "Remove"));
    await addImage("d.png");
    await addImage("e.png");
    expect(tiles()).toEqual([
      "https://cdn.test/products/c.webp",
      "https://cdn.test/products/d.png",
      "https://cdn.test/products/e.png",
    ]);
    await save();

    expect(alertText()).toBe("");
    expect(savedSources()).toEqual([
      "https://cdn.test/products/c.webp",
      "https://cdn.test/products/d.png",
      "https://cdn.test/products/e.png",
    ]);
    for (const img of server.images) expect(img.position).toBeGreaterThanOrEqual(1);
  });

  it("retries a save that failed part-way without re-deleting or duplicating images", async () => {
    server.images = [image("old", 1)];
    await mountEditor();

    await addImage("one.png");
    await addImage("two.png");
    await click(tileButton(0, "Remove"));
    const realSave = api.saveProductImage.getMockImplementation()!;
    api.saveProductImage
      .mockImplementationOnce(realSave)
      .mockImplementationOnce(async () => { throw serverRejects(503, "SERVICE_UNAVAILABLE"); });
    await save();
    expect(alertText()).not.toBe("");
    expect(assign).not.toHaveBeenCalled();

    await save();

    expect(alertText()).toBe("");
    expect(savedSources()).toEqual(["https://cdn.test/products/one.png", "https://cdn.test/products/two.png"]);
    expect(api.deleteProductImage.mock.calls.map(([, imageId]) => imageId)).toEqual(["old"]);
    expect(api.saveProductImage.mock.calls.map(([, body]) => body.mediaKey)).toEqual([
      "products/one.png",
      "products/two.png",
      "products/two.png",
    ]);
    expect(assign).toHaveBeenCalledWith("/products");
  });

  it("removes an image and reorders the rest, then saves both changes together", async () => {
    server.images = [image("a", 1), image("b", 2), image("c", 3)];
    await mountEditor();

    await click(tileButton(0, "Remove"));
    await click(tileButton(1, "Move earlier"));
    expect(tiles()).toEqual(["https://cdn.test/products/c.webp", "https://cdn.test/products/b.webp"]);
    expect(api.reorderProductImages).not.toHaveBeenCalled();
    expect(savedSources()).toHaveLength(3);
    await save();

    expect(alertText()).toBe("");
    expect(savedSources()).toEqual(["https://cdn.test/products/c.webp", "https://cdn.test/products/b.webp"]);
  });

  it("makes a newly added image the main one when it is moved first", async () => {
    server.images = [image("a", 1)];
    await mountEditor();

    await addImage("main.png");
    await click(tileButton(1, "Move earlier"));
    expect(tiles()).toEqual(["https://cdn.test/products/main.png", "https://cdn.test/products/a.webp"]);
    await save();

    expect(alertText()).toBe("");
    expect(savedSources()).toEqual(["https://cdn.test/products/main.png", "https://cdn.test/products/a.webp"]);
  });
});

function variant(id: string, size: string, sku: string): ProductVariant {
  return {
    id,
    productId: PRODUCT_ID,
    variations: { Size: size },
    currency: "DZD",
    price: 4500,
    sku,
    inventory: 2,
    lowStockThreshold: 5,
    isDefault: false,
    active: true,
    position: 1,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const buttonLabelled = (label: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === label)!;

describe("editing a product's variants", () => {
  it("retries a save that failed part-way without creating a variant twice", async () => {
    server.product = {
      ...server.product,
      hasVariants: true,
      variantOptions: [{ name: "Size", values: [{ value: "M" }, { value: "L" }, { value: "XL" }] }],
    };
    server.variants = [variant("variant-m", "M", "KAF-M")];
    await mountEditor();

    type(host.querySelector<HTMLInputElement>('input[placeholder="SKU prefix"]')!, "KAF");
    await click(buttonLabelled("Auto SKU"));
    const realCreate = api.createVariant.getMockImplementation()!;
    api.createVariant
      .mockImplementationOnce(realCreate)
      .mockImplementationOnce(async () => { throw serverRejects(503, "SERVICE_UNAVAILABLE"); });
    await save();
    expect(alertText()).toContain("Variant XL could not be saved");

    await save();

    expect(alertText()).toBe("");
    expect(server.variants.map((item) => [item.variations.Size, item.sku])).toEqual([
      ["M", "KAF-001"],
      ["L", "KAF-002"],
      ["XL", "KAF-003"],
    ]);
    expect(assign).toHaveBeenCalledWith("/products");
  });
});
