import { describe, expect, it } from "vitest";
import { themeSourceFiles } from "./theme-source";

const files = themeSourceFiles();

describe("one checkout, one order", () => {
  const orderForms = files.flatMap((file) =>
    [...file.content.matchAll(/<form\b[^>]*>/g)]
      .map((match) => match[0])
      .filter((tag) => tag.includes("action={actions.placeOrder}"))
      .map((tag) => ({ file: file.relPath, tag, content: file.content })),
  );

  it("finds the order forms — a renamed action must not pass vacuously", () => {
    expect(orderForms.map((form) => form.file).sort()).toEqual(["theme/components/checkout/CheckoutMain.astro", "theme/components/order/OrderForm.astro"]);
  });

  it("gives every order form its checkout key, loaded beside it", () => {
    expect(orderForms.filter((form) => !/\bdata-checkout\b/.test(form.tag)).map((form) => form.file)).toEqual([]);
    expect(orderForms.filter((form) => !/<script src="[^"]*scripts\/checkout-key\.ts"><\/script>/.test(form.content)).map((form) => form.file)).toEqual([]);
  });
});
