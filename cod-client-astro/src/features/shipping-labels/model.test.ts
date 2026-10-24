import { describe, expect, it } from "vitest";
import { QUIET_MODULES, barcodeGeometry, deliverySheetHref, labelItems, printLabelsHref, readLabelsQuery, sampleParcel } from "./model";

describe("printing labels", () => {
  it("links to the print page and reads the link back", () => {
    const href = printLabelsHref({ shipmentIds: ["s 1", "s2"] });
    expect(href).toBe("/print/labels?shipments=s%201,s2");
    expect(readLabelsQuery(href.split("?")[1])).toEqual({ shipmentIds: ["s 1", "s2"] });
    expect(readLabelsQuery(printLabelsHref({ driverId: "dr/1" }).split("?")[1])).toEqual({ driverId: "dr/1" });
    expect(deliverySheetHref("dr1")).toBe("/print/delivery-sheet?driver=dr1");
  });

  it("names nothing to print without shipments or a driver, and at most a hundred", () => {
    expect(readLabelsQuery("")).toBeNull();
    expect(readLabelsQuery("shipments=,,")).toBeNull();
    expect(readLabelsQuery("shipments=a,a,b")).toEqual({ shipmentIds: ["a", "b"] });
    expect((readLabelsQuery(`shipments=${Array.from({ length: 150 }, (_, i) => i).join(",")}`) as { shipmentIds: string[] }).shipmentIds).toHaveLength(100);
  });

  it("lists what fits on the label and counts the rest", () => {
    const items = (n: number) => ({ items: Array.from({ length: n }, (_, i) => ({ name: `P${i}`, variant: null, quantity: 1 })) });
    expect(labelItems(items(5))).toMatchObject({ more: 0 });
    expect(labelItems(items(5)).shown).toHaveLength(5);
    expect(labelItems(items(9))).toMatchObject({ more: 5 });
    expect(labelItems(items(9)).shown).toHaveLength(4);
  });

  it("draws the barcode in whole thermal dots, with quiet zones, narrower only when it must", () => {
    const wide = barcodeGeometry("ORD-20261024-4730", 92);
    expect(wide.moduleMm).toBe(0.375);
    expect(wide.widthMm).toBeLessThanOrEqual(92);
    expect(wide.bars[0].x).toBe(QUIET_MODULES);
    const last = wide.bars.at(-1)!;
    expect(last.x + last.width).toBe(wide.modules - QUIET_MODULES);

    const narrow = barcodeGeometry("ORD-20261024-4730", 40);
    expect(narrow.widthMm).toBeCloseTo(40);
    expect(narrow.moduleMm).toBeLessThan(0.375);
  });

  it("previews with a parcel in the label's language", () => {
    expect(sampleParcel("ar").recipient.name).toMatch(/[؀-ۿ]/);
    expect(sampleParcel("fr").recipient.name).toMatch(/^[A-Za-z ]+$/);
  });
});
