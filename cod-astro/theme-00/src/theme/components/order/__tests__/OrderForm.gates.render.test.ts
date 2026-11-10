// @vitest-environment node
// Must run in node: under happy-dom the Astro plugin resolves `.astro` imports
// to the browser stub, which throws instead of rendering.
/// <reference types="vitest/globals" />
/**
 * The OTP step and the bot gate bring their own scripts. A store that has
 * them switched off must not download them: the OTP script pulls the SDK's
 * response schemas with it, and every product page used to load both for
 * every store. Rendered through the Container API, the order form is the
 * evidence — each script appears exactly when its part does.
 */
import { testLocals } from "../../../__tests__/support/locals";
import { productFixture } from "../../../__tests__/support/product";
import { describe, expect, it, vi } from "vitest";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import OrderForm from "../OrderForm.astro";
import { en as enContent } from "@/theme/content/en";

vi.mock("astro:actions", () => ({
  actions: { placeOrder: "/_actions/placeOrder" },
}));

async function render(gates: { otpEnabled?: boolean; turnstileEnabled?: boolean; turnstileSiteKey?: string | null }): Promise<string> {
  const container = await AstroContainer.create();
  return container.renderToString(OrderForm, {
    locals: testLocals(),
    props: {
      product: productFixture(),
      content: enContent,
      fieldErrors: {},
      notice: null,
      basePrice: 4500,
      defaultVariant: null,
      cur: "DZD",
      isRTL: false,
      offers: [],
      defaultVariantId: null,
      ...gates,
    },
  });
}

/**
 * The module scripts a component brought into the output. Astro emits a
 * component's `<script>` where that component renders — under the Container
 * API as a module pointing back at the component itself — so its presence is
 * the evidence that rendering, and only rendering, loads it.
 */
const scriptTags = (html: string, component: string) =>
  [...html.matchAll(/<script\b[^>]*>/g)].filter((tag) => tag[0].includes(`${component}.astro?astro&type=script`));

describe("OrderForm — the OTP step and the bot gate", () => {
  it("loads neither script for a store that has both switched off", async () => {
    const html = await render({});

    expect(html).toContain('id="submit-btn"');
    expect(html).not.toContain('id="otp-step"');
    expect(html).not.toContain('id="turnstile-field"');
    expect(scriptTags(html, "OtpStep")).toEqual([]);
    expect(scriptTags(html, "TurnstileField")).toEqual([]);
    expect(html).not.toContain("challenges.cloudflare.com");
  });

  it("loads the OTP script, once, with the OTP step", async () => {
    const html = await render({ otpEnabled: true });

    expect(html).toContain('id="otp-step"');
    expect(scriptTags(html, "OtpStep")).toHaveLength(1);
    expect(scriptTags(html, "TurnstileField")).toEqual([]);
  });

  it("loads the bot gate's script and the widget with the bot gate", async () => {
    const html = await render({ turnstileEnabled: true, turnstileSiteKey: "0x4AAAAAAAtest" });

    expect(html).toContain('id="turnstile-field"');
    expect(scriptTags(html, "TurnstileField")).toHaveLength(1);
    expect(html).toContain("challenges.cloudflare.com/turnstile/v0/api.js");
    expect(scriptTags(html, "OtpStep")).toEqual([]);
  });

  it("keeps the bot gate off without a site key, even when it is switched on", async () => {
    const html = await render({ turnstileEnabled: true, turnstileSiteKey: null });

    expect(html).not.toContain('id="turnstile-field"');
    expect(scriptTags(html, "TurnstileField")).toEqual([]);
  });
});

describe("OrderForm — a refused order", () => {
  async function refused(notice: string | null, fieldErrors: Record<string, string[]> = {}): Promise<string> {
    const container = await AstroContainer.create();
    return container.renderToString(OrderForm, {
      locals: testLocals(),
      props: { product: productFixture(), content: enContent, fieldErrors, notice, basePrice: 4500, defaultVariant: null, cur: "DZD", isRTL: false, offers: [], defaultVariantId: null },
    });
  }

  it("says why above the form, as an alert, and marks the field to fix", async () => {
    const html = await refused(enContent.formFixFields, { phone: [enContent.formFieldInvalid] });
    expect(html.slice(html.indexOf('role="alert"'))).toContain(enContent.formFixFields);
    expect(html).toMatch(/name="phone"[^>]*aria-invalid="true"[^>]*aria-describedby="f-phone-error"/);
    expect(html).toContain(`id="f-phone-error" class="field-error"`);
    expect(html).not.toMatch(/name="customerName"[^>]*aria-invalid/);
  });

  it("shows no alert before the shopper sends the form", async () => {
    expect(await refused(null)).not.toContain('class="order-error"');
  });
});
