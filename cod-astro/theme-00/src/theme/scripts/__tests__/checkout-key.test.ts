/**
 * Every order form carries the checkout key: the same one while the shopper
 * changes nothing, a new one once they change a field, and no other form is
 * touched.
 */

/// <reference types="vitest/globals" />

import { bindCheckoutForms } from "../checkout-key";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function page(): void {
  document.body.innerHTML = `
    <form method="POST" action="/_actions/placeOrder" class="order-form" data-checkout>
      <input name="customerName" value="Amel Kaci" />
    </form>
    <form method="POST" action="/_actions/placeOrder" id="checkout-form" data-checkout>
      <input name="customerName" value="Karim" />
    </form>
    <form method="POST" action="/_actions/lookupOrder" id="track">
      <input name="orderNumber" value="C-1" />
    </form>`;
}

/** A submission's entries, as a browser builds them: happy-dom has no `formdata` event, so it is fired here. */
function keyOf(selector: string) {
  const form = document.querySelector<HTMLFormElement>(selector)!;
  const formData = new FormData(form);
  form.dispatchEvent(Object.assign(new Event("formdata"), { formData }));
  return formData.get("checkoutKey");
}

let unbind: () => void;
beforeEach(() => {
  page();
  unbind = bindCheckoutForms();
});
afterEach(() => unbind());

it("puts a key on every order form's submission, each its own", () => {
  const product = keyOf(".order-form");
  const basket = keyOf("#checkout-form");
  expect(product).toMatch(UUID);
  expect(basket).toMatch(UUID);
  expect(product).not.toBe(basket);
});

it("keeps it while nothing changes, and draws a new one once a field changes", () => {
  const first = keyOf(".order-form");
  expect(keyOf(".order-form")).toBe(first);
  const name = document.querySelector<HTMLInputElement>(".order-form [name=customerName]")!;
  name.value = "Amel K.";
  name.dispatchEvent(new Event("input", { bubbles: true }));
  const second = keyOf(".order-form");
  expect(second).not.toBe(first);
  expect(keyOf(".order-form")).toBe(second);
});

it("leaves every other form alone", () => {
  expect(keyOf("#track")).toBeNull();
});

it("stops when the page is left", () => {
  unbind();
  expect(keyOf(".order-form")).toBeNull();
});
