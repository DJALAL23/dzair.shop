// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ProductStatusBadge } from "./ProductRow";
import type { Product } from "@/features/products/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const product = (extra: Partial<Product>) => ({ id: "p", name: "P", handle: "p", currency: "DZD", price: 1000, type: "PHYSICAL", hasVariants: false, sku: "P-1", inventory: 0, trackInventory: false, status: "ACTIVE", showInStore: true, ...extra }) as Product;

async function badge(item: Product, locale = "en") {
  localStorage.setItem("locale", locale);
  document.documentElement.lang = locale;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<ProductStatusBadge product={item} />));
  const text = host.textContent ?? "";
  await act(async () => root.unmount());
  return text;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("a product's status in the list", () => {
  it("warns that a product without options and without a SKU cannot be ordered", async () => {
    expect(await badge(product({ sku: null }))).toBe("No SKU, can't be ordered");
    expect(await badge(product({ sku: null }), "fr")).toBe("Sans SKU, non commandable");
  });

  it("is active once it has a SKU, or options that carry theirs", async () => {
    expect(await badge(product({}))).toBe("Active");
    expect(await badge(product({ sku: null, hasVariants: true }))).toBe("Active");
  });

  it("says draft before anything else", async () => {
    expect(await badge(product({ sku: null, status: "DRAFT" }))).toBe("Draft");
  });
});
