// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SHIPPING_LABEL_CONFIG, type ShippingLabelConfig } from "../../../../../cod-shared/shipping-label/config";
import { sampleParcel } from "@/features/shipping-labels/model";
import { ShippingLabel } from "./ShippingLabel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const sender = { name: "Maison Lina", logoUrl: "https://media.example.com/logo.webp", phone: "0661234567", address: "12 Rue Didouche Mourad, Alger" };
const currency = { code: "DZD", symbol: "دج" };

function render(config: Partial<ShippingLabelConfig> = {}, parcel = sampleParcel(config.language ?? "fr")) {
  act(() => root.render(<ShippingLabel parcel={parcel} batch={{ config: { ...DEFAULT_SHIPPING_LABEL_CONFIG, ...config }, sender, currency }} />));
  return host.querySelector<HTMLElement>("[data-shipping-label]")!;
}

describe("a driver's shipping label", () => {
  it("prints the customer, the place, the cash to collect, the contents and the order's barcode", () => {
    const label = render();
    const text = label.textContent ?? "";
    expect(label.getAttribute("dir")).toBe("ltr");
    for (const part of ["Destinataire", "Amina Benali", "0551 23 45 67", "Bab Ezzouar · Alger", "Montant à encaisser", "3 700 DA", "2 ×", "Robe d'été (M / Rouge)", "Appeler avant de venir", "Livreur : Samir Bey", "Maison Lina", "Tél. 0661 23 45 67"]) {
      expect(text).toContain(part);
    }
    const barcode = label.querySelector('svg[role="img"]')!;
    expect(barcode.getAttribute("aria-label")).toBe("ORD-20261024-4730");
    expect(barcode.querySelectorAll("rect").length).toBeGreaterThan(20);
    expect(label.querySelector("img")?.getAttribute("src")).toBe(sender.logoUrl);
  });

  it("is written right to left in Arabic, with the dinar as دج", () => {
    const label = render({ language: "ar" });
    expect(label.getAttribute("dir")).toBe("rtl");
    expect(label.textContent).toContain("المبلغ المطلوب تحصيله");
    expect(label.textContent).toContain("3 700 دج");
    expect(label.textContent).toContain("باب الزوار · الجزائر");
  });

  it("leaves out what the store turned off, and prints its own line and the opening rule", () => {
    const label = render({ showLogo: false, showItems: false, showNotes: false, openParcel: "forbidden", footer: "Merci pour votre confiance" });
    const text = label.textContent ?? "";
    expect(label.querySelector("img")).toBeNull();
    expect(text).not.toContain("Robe d'été");
    expect(text).not.toContain("Appeler avant de venir");
    expect(text).toContain("Ouverture du colis interdite");
    expect(text).toContain("Merci pour votre confiance");
  });

  it("counts the lines it has no room for", () => {
    const parcel = { ...sampleParcel("fr"), items: Array.from({ length: 8 }, (_, i) => ({ name: `Article ${i + 1}`, variant: null, quantity: 1 })) };
    const label = render({}, parcel);
    expect(label.querySelectorAll("li")).toHaveLength(5);
    expect(label.textContent).toContain("+ 4 autres articles");
  });
});
