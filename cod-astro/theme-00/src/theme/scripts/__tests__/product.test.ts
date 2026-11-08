/**
 * Product Script — Preservation Tests
 *
 * These tests verify the product page script initializes correctly on
 * initial page load (variant selection, quantity steppers, price updates).
 * Client-side navigation rebinds the page through onEachPage (see
 * page-lifecycle.test.ts); this suite covers the first load.
 */
/// <reference types="vitest/globals" />

import * as fc from "fast-check";
import { communesForWilaya } from "@wocart/storefront";
import { initProductPage } from "../product.ts";
import { serverQuote } from "@/theme/__tests__/support/quote";

/** A quote as the server sends it (`serverQuote`). */
const served = (data: Record<string, unknown>) => serverQuote(data);

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) }) as unknown as Response));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// The page asks the server for its delivery quote. A test that does not care
// runs offline — the request is refused, not sent to a port nobody listens on.
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("offline"))));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Property 2: Preservation - Initial Page Load Behavior", () => {
  let container: HTMLElement;

  beforeEach(() => {
    // Create a fresh DOM for each test
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    // Clean up
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  /**
   * Helper function to create a complete product page DOM structure
   */
  function createProductPageDOM(config?: {
    variants?: Array<{ id: string; price: number; variations: Record<string, string>; isDefault?: boolean; active: boolean; position: number }>;
    basePrice?: number;
    hasOffers?: boolean;
    initialQuantity?: number;
  }) {
    const variants = config?.variants || [
      { id: "v1", price: 1000, compareAtPrice: null, variations: { Color: "Red" }, isDefault: true, active: true, position: 0 },
      { id: "v2", price: 1200, compareAtPrice: null, variations: { Color: "Blue" }, isDefault: false, active: true, position: 1 },
    ];
    const basePrice = config?.basePrice || 1000;
    const initialQuantity = config?.initialQuantity || 1;
    const offers = config?.hasOffers ? [
      {
        id: "offer1",
        discountType: "free",
        triggerQuantity: 2,
        triggerVariantId: null,
        rewardQuantity: 1,
        rewardProductName: "Free Item",
        rewardVariantLabel: null,
      },
    ] : [];

    const html = `
      <div id="page-data"
        data-variants='${JSON.stringify(variants)}'
        data-base-price="${basePrice}"
        data-cur="DA"
        data-is-rtl="0"
        data-shipping-calc="Calculated at checkout"
        data-shipping-free="Free"
        data-commune-placeholder="Select commune"
        data-commune-loading="Loading..."
        data-commune-disabled="Select wilaya first"
        data-offers='${JSON.stringify(offers)}'
      ></div>
      
      <input type="number" id="qty-input" value="${initialQuantity}" />
      <button id="qty-minus">-</button>
      <button id="qty-plus">+</button>
      
      <button class="variant-opt" data-option="Color" data-value="Red">Red</button>
      <button class="variant-opt" data-option="Color" data-value="Blue">Blue</button>
      
      <div id="gallery"></div>
      <button class="gallery-thumb" data-index="0">Thumb 1</button>
      <button class="gallery-thumb" data-index="1">Thumb 2</button>
      
      <div id="price-display-desktop"></div>
      <div id="price-display-mobile"></div>
      <div id="sticky-price"></div>
      <div id="summary-item-price"></div>
      <div id="summary-total"></div>
      <div id="summary-shipping"></div>
      <div id="summary-qty-label"></div>
      
      <input type="hidden" id="price-input" />
      <input type="hidden" id="variant-id-input" />
      <input type="hidden" id="variant-label-input" />
    `;
    
    container.innerHTML = html;
  }

  /**
   * Simulates initial page load by creating DOM and calling initProductPage directly
   */
  function simulateInitialPageLoad() {
    createProductPageDOM();
    
    // Call initProductPage directly to simulate what happens on initial page load
    // In the real browser, this is called by the auto-execution block
    initProductPage();
    
    return container;
  }

  /**
   * Checks if interactive elements are functional
   */
  function checkInteractiveElementsFunctional(): {
    variantButtonsWork: boolean;
    quantitySteppersWork: boolean;
    priceDisplayUpdates: boolean;
  } {
    const variantButton = container.querySelector<HTMLButtonElement>(".variant-opt[data-value='Blue']");
    const qtyPlusButton = container.querySelector<HTMLButtonElement>("#qty-plus");
    const qtyInput = container.querySelector<HTMLInputElement>("#qty-input");
    const priceDisplay = container.querySelector<HTMLElement>("#price-display-desktop");
    
    // Test variant button functionality
    let variantButtonsWork = false;
    if (variantButton) {
      const initialClasses = variantButton.className;
      variantButton.click();
      const afterClickClasses = variantButton.className;
      // If event listener is attached, clicking should change classes
      variantButtonsWork = initialClasses !== afterClickClasses;
    }
    
    // Test quantity stepper functionality
    let quantitySteppersWork = false;
    if (qtyPlusButton && qtyInput) {
      const initialValue = parseInt(qtyInput.value);
      qtyPlusButton.click();
      const afterClickValue = parseInt(qtyInput.value);
      // If event listener is attached, clicking + should increment value
      quantitySteppersWork = afterClickValue > initialValue;
    }
    
    // Test price display updates
    let priceDisplayUpdates = false;
    if (priceDisplay) {
      // Price should be populated on initialization
      priceDisplayUpdates = priceDisplay.textContent !== null && priceDisplay.textContent.length > 0;
    }
    
    return {
      variantButtonsWork,
      quantitySteppersWork,
      priceDisplayUpdates,
    };
  }

  /**
   * Concrete test: Initial page load should initialize all interactive elements
   */
  it("should initialize all interactive elements on initial page load", () => {
    // Simulate initial page load
    simulateInitialPageLoad();
    
    // Check if interactive elements are functional
    const result = checkInteractiveElementsFunctional();
    
    // EXPECTED OUTCOME on UNFIXED code: These assertions PASS
    // This confirms the baseline behavior that must be preserved
    expect(result.variantButtonsWork).toBe(true);
    expect(result.quantitySteppersWork).toBe(true);
    expect(result.priceDisplayUpdates).toBe(true);
  });

  /**
   * Property-based test: For ANY initial page load configuration,
   * the script MUST initialize and all interactive elements MUST be functional.
   * 
   * This test uses fast-check to generate multiple product configurations.
   */
  it("property: script initializes correctly for all initial page load configurations", () => {
    fc.assert(
      fc.property(
        // Generate arbitrary product configurations
        fc.record({
          basePrice: fc.integer({ min: 100, max: 10000 }),
          initialQuantity: fc.integer({ min: 1, max: 10 }),
          hasOffers: fc.boolean(),
          variantCount: fc.integer({ min: 1, max: 3 }),
        }),
        (config) => {
          // Setup: Create product page with generated configuration
          const testContainer = document.createElement("div");
          document.body.appendChild(testContainer);
          
          // Generate variants based on config
          const variants = Array.from({ length: config.variantCount }, (_, i) => ({
            id: `v${i + 1}`,
            price: config.basePrice + i * 100,
            variations: { Color: ["Red", "Blue", "Green"][i] || "Red" },
            isDefault: i === 0,
            active: true,
            position: i,
          }));
          
          const html = `
            <div id="page-data"
              data-variants='${JSON.stringify(variants)}'
              data-base-price="${config.basePrice}"
              data-cur="DA"
              data-is-rtl="0"
              data-shipping-calc="Calculated at checkout"
              data-shipping-free="Free"
              data-commune-placeholder="Select commune"
              data-commune-loading="Loading..."
              data-commune-disabled="Select wilaya first"
              data-offers='${config.hasOffers ? '[{"id":"o1","discountType":"free","triggerQuantity":2}]' : '[]'}'
            ></div>
            
            <input type="number" id="qty-input" value="${config.initialQuantity}" />
            <button id="qty-minus">-</button>
            <button id="qty-plus">+</button>
            
            ${variants.map((v, i) => `<button class="variant-opt" data-option="Color" data-value="${v.variations.Color}">${v.variations.Color}</button>`).join('\n')}
            
            <div id="price-display-desktop"></div>
            <input type="hidden" id="price-input" />
            <input type="hidden" id="variant-id-input" />
          `;
          
          testContainer.innerHTML = html;
          
          // Simulate initial page load by calling initProductPage
          initProductPage();
          
          // Verify: Interactive elements should be functional
          const qtyPlusButton = testContainer.querySelector<HTMLButtonElement>("#qty-plus");
          const qtyInput = testContainer.querySelector<HTMLInputElement>("#qty-input");
          const priceDisplay = testContainer.querySelector<HTMLElement>("#price-display-desktop");
          
          let quantitySteppersWork = false;
          if (qtyPlusButton && qtyInput) {
            const initialValue = parseInt(qtyInput.value);
            qtyPlusButton.click();
            const afterClickValue = parseInt(qtyInput.value);
            quantitySteppersWork = afterClickValue > initialValue;
          }
          
          const priceDisplayUpdates = priceDisplay && priceDisplay.textContent !== null && priceDisplay.textContent.length > 0;
          
          // Cleanup
          if (testContainer.parentNode) {
            testContainer.parentNode.removeChild(testContainer);
          }
          
          // EXPECTED OUTCOME on UNFIXED code: This property PASSES
          // Confirms baseline behavior across many configurations
          return quantitySteppersWork && !!priceDisplayUpdates;
        }
      ),
      {
        numRuns: 20, // Run 20 different configurations
        verbose: true,
      }
    );
  });

  /**
   * Edge case: Multiple initial page loads should each initialize correctly
   * 
   * This tests that the script can be loaded multiple times without issues.
   */
  it("edge case: script handles multiple initializations without errors", () => {
    // First initialization
    createProductPageDOM();
    initProductPage();
    const result1 = checkInteractiveElementsFunctional();
    
    // Clean up and create new DOM
    container.innerHTML = "";
    
    // Second initialization
    createProductPageDOM({ basePrice: 2000, initialQuantity: 2 });
    initProductPage();
    const result2 = checkInteractiveElementsFunctional();
    
    // EXPECTED OUTCOME on UNFIXED code: Both PASS
    // Script should handle re-initialization gracefully
    expect(result1.quantitySteppersWork).toBe(true);
    expect(result2.quantitySteppersWork).toBe(true);
  });

  /**
   * Concrete test: Variant selection should work on initial page load
   */
  it("should allow variant selection on initial page load", () => {
    simulateInitialPageLoad();
    
    const redButton = container.querySelector<HTMLButtonElement>(".variant-opt[data-value='Red']");
    const blueButton = container.querySelector<HTMLButtonElement>(".variant-opt[data-value='Blue']");
    const variantIdInput = container.querySelector<HTMLInputElement>("#variant-id-input");
    
    expect(redButton).not.toBeNull();
    expect(blueButton).not.toBeNull();
    expect(variantIdInput).not.toBeNull();
    
    if (blueButton && variantIdInput) {
      // Click blue variant
      blueButton.click();
      
      // Variant ID should update
      expect(variantIdInput.value).toBe("v2");
    }
  });

  /**
   * Concrete test: Quantity steppers should work on initial page load
   */
  it("should allow quantity changes on initial page load", () => {
    simulateInitialPageLoad();
    
    const qtyInput = container.querySelector<HTMLInputElement>("#qty-input");
    const qtyPlusButton = container.querySelector<HTMLButtonElement>("#qty-plus");
    const qtyMinusButton = container.querySelector<HTMLButtonElement>("#qty-minus");
    
    expect(qtyInput).not.toBeNull();
    expect(qtyPlusButton).not.toBeNull();
    expect(qtyMinusButton).not.toBeNull();
    
    if (qtyInput && qtyPlusButton && qtyMinusButton) {
      // Initial value should be 1
      expect(parseInt(qtyInput.value)).toBe(1);
      
      // Click plus button
      qtyPlusButton.click();
      expect(parseInt(qtyInput.value)).toBe(2);
      
      // Click plus again
      qtyPlusButton.click();
      expect(parseInt(qtyInput.value)).toBe(3);
      
      // Click minus button
      qtyMinusButton.click();
      expect(parseInt(qtyInput.value)).toBe(2);
    }
  });

  /**
   * Concrete test: Price display should update on initial page load
   */
  it("should display and update prices on initial page load", () => {
    simulateInitialPageLoad();
    
    const priceDisplay = container.querySelector<HTMLElement>("#price-display-desktop");
    const qtyInput = container.querySelector<HTMLInputElement>("#qty-input");
    const qtyPlusButton = container.querySelector<HTMLButtonElement>("#qty-plus");
    
    expect(priceDisplay).not.toBeNull();
    
    if (priceDisplay && qtyInput && qtyPlusButton) {
      // Price should be displayed initially
      expect(priceDisplay.textContent).toContain("1");
      
      // Change quantity
      qtyPlusButton.click();
      
      // Summary should update (we're checking that the script is responsive)
      const summaryItemPrice = container.querySelector<HTMLElement>("#summary-item-price");
      if (summaryItemPrice) {
        expect(summaryItemPrice.textContent).toContain("2");
      }
    }
  });
});

interface DeferredResponse {
  promise: Promise<Response>;
  resolve: (response: Response) => void;
  reject: (reason?: unknown) => void;
}

function createDeferredResponse(): DeferredResponse {
  let resolve!: (response: Response) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Response>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function communeResponse(name: string): Response {
  return new Response(JSON.stringify({ data: [{ id: name, name, nameAr: name }] }), {
    headers: { "Content-Type": "application/json" },
  });
}

async function flushCommuneUpdates() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("Commune loading race protection", () => {
  let container: HTMLElement;
  let originalFetch: typeof fetch;
  let originalPopulate: typeof window.__selectPopulate;
  let originalSetLoading: typeof window.__selectSetLoading;
  let originalSetDisabled: typeof window.__selectSetDisabled;

  beforeEach(() => {
    container = document.createElement("div");
    container.innerHTML = `
      <div id="page-data"
        data-variants='[{"id":"v1","price":1000,"compareAtPrice":null,"inventory":10,"variations":{},"isDefault":true,"active":true,"position":0,"imageId":null}]'
        data-cur="DA"
        data-is-rtl="0"
        data-shipping-calc="Calculated at checkout"
        data-shipping-free="Free"
        data-commune-placeholder="Select commune"
        data-commune-loading="Loading..."
        data-commune-disabled="Select wilaya first"
        data-offers='[]'
      ></div>
      <select id="f-wilaya">
        <option value="">Select wilaya</option>
        <option value="16">Alger</option>
        <option value="98">Custom 98</option>
        <option value="99">Custom 99</option>
      </select>
    `;
    document.body.appendChild(container);

    originalFetch = window.fetch;
    originalPopulate = window.__selectPopulate;
    originalSetLoading = window.__selectSetLoading;
    originalSetDisabled = window.__selectSetDisabled;
    window.__selectSetLoading = () => undefined;
    window.__selectSetDisabled = () => undefined;
  });

  afterEach(() => {
    window.fetch = originalFetch;
    if (originalPopulate) window.__selectPopulate = originalPopulate;
    else Reflect.deleteProperty(window, "__selectPopulate");
    if (originalSetLoading) window.__selectSetLoading = originalSetLoading;
    else Reflect.deleteProperty(window, "__selectSetLoading");
    if (originalSetDisabled) window.__selectSetDisabled = originalSetDisabled;
    else Reflect.deleteProperty(window, "__selectSetDisabled");
    container.remove();
  });

  function startCommuneRequests() {
    const requests: Array<{ url: string; deferred: DeferredResponse }> = [];
    window.fetch = vi.fn((input: RequestInfo | URL) => {
      // Only commune loads are counted here. A quote for the delivery is a
      // request too, and it has its own tests; it is refused, not held open.
      if (!String(input).startsWith("/api/communes/")) {
        return Promise.reject(new TypeError("not a commune request"));
      }
      const deferred = createDeferredResponse();
      requests.push({ url: String(input), deferred });
      return deferred.promise;
    });

    const populateCalls: SelectOption[][] = [];
    window.__selectPopulate = (_id, options) => {
      populateCalls.push(options);
    };

    const wilayaSelect = container.querySelector<HTMLSelectElement>("#f-wilaya");
    if (!wilayaSelect) throw new Error("Wilaya selector was not created");
    initProductPage();

    const selectWilaya = (wilayaId: string) => {
      wilayaSelect.value = wilayaId;
      wilayaSelect.dispatchEvent(new Event("change", { bubbles: true }));
    };

    return { requests, populateCalls, selectWilaya };
  }

  it("resolves bundled wilaya communes synchronously without network request", () => {
    const { requests, populateCalls, selectWilaya } = startCommuneRequests();

    selectWilaya("16");

    expect(requests).toHaveLength(0);
    expect(populateCalls).toHaveLength(1);
    expect(populateCalls[0].map((option) => option.value)).toEqual(communesForWilaya(16).map((commune) => commune.id));
  });

  it("ignores a stale successful response for unbundled wilayas", async () => {
    const { requests, populateCalls, selectWilaya } = startCommuneRequests();

    selectWilaya("98");
    selectWilaya("99");
    requests[1].deferred.resolve(communeResponse("Custom99"));
    await flushCommuneUpdates();
    requests[0].deferred.resolve(communeResponse("Custom98"));
    await flushCommuneUpdates();

    expect(populateCalls).toHaveLength(1);
    expect(populateCalls[0].map((option) => option.value)).toEqual(["Custom99"]);
  });

  it("ignores a stale error after the latest request succeeds for unbundled wilayas", async () => {
    const { requests, populateCalls, selectWilaya } = startCommuneRequests();

    selectWilaya("98");
    selectWilaya("99");
    requests[1].deferred.resolve(communeResponse("Custom99"));
    await flushCommuneUpdates();
    requests[0].deferred.reject(new Error("Custom98 request failed"));
    await flushCommuneUpdates();

    expect(populateCalls).toHaveLength(1);
    expect(populateCalls[0].map((option) => option.value)).toEqual(["Custom99"]);
  });

  it("accepts only the latest request in Wilaya 98 to 99 to 98", async () => {
    const { requests, populateCalls, selectWilaya } = startCommuneRequests();

    selectWilaya("98");
    selectWilaya("99");
    selectWilaya("98");
    requests[2].deferred.resolve(communeResponse("latest-98"));
    await flushCommuneUpdates();
    requests[0].deferred.resolve(communeResponse("stale-98"));
    await flushCommuneUpdates();
    requests[1].deferred.resolve(communeResponse("stale-99"));
    await flushCommuneUpdates();

    expect(populateCalls).toHaveLength(1);
    expect(populateCalls[0].map((option) => option.value)).toEqual(["latest-98"]);
  });
});

/**
 * Gallery — dots, thumbnails and the scroll they drive.
 *
 * happy-dom has no layout engine, so the track's width and `scrollTo` are
 * stubbed: what is under test is the arithmetic and the wiring, not the
 * browser's scrolling.
 */
describe("Gallery", () => {
  const TRACK_WIDTH = 400;
  let container: HTMLElement;
  let scrolls: Array<{ left: number; behavior?: string }>;

  function mountGallery(options: { images?: number; rtl?: boolean } = {}) {
    const images = options.images ?? 3;
    container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = `
      <div id="page-data" data-variants="[]" data-base-price="1000" data-cur="DA"
           data-is-rtl="${options.rtl ? 1 : 0}" data-offers="[]"></div>
      <div id="gallery">
        ${Array.from({ length: images }, (_, i) => `<div class="gallery-slide" data-image-id="img-${i}"></div>`).join("")}
      </div>
      <div id="gallery-dots">
        ${Array.from({ length: images }, (_, i) => `<button class="gallery-dot" data-index="${i}"><span></span></button>`).join("")}
      </div>
      ${Array.from({ length: images }, (_, i) => `<button class="gallery-thumb" data-index="${i}"></button>`).join("")}
    `;

    const track = document.getElementById("gallery") as HTMLElement;
    Object.defineProperty(track, "clientWidth", { value: TRACK_WIDTH, configurable: true });
    scrolls = [];
    track.scrollTo = ((opts: ScrollToOptions) => {
      scrolls.push({ left: opts.left as number, behavior: opts.behavior });
      Object.defineProperty(track, "scrollLeft", { value: opts.left, configurable: true });
    }) as HTMLElement["scrollTo"];
    if (options.rtl) track.style.direction = "rtl";

    initProductPage();
    return track;
  }

  afterEach(() => {
    container?.parentNode?.removeChild(container);
  });

  const dots = () => [...document.querySelectorAll<HTMLButtonElement>(".gallery-dot")];
  const thumbs = () => [...document.querySelectorAll<HTMLButtonElement>(".gallery-thumb")];
  const pip = (i: number) => dots()[i].firstElementChild as HTMLElement;

  it("scrolls to an image when its dot is tapped", () => {
    mountGallery();
    dots()[2].click();
    expect(scrolls).toEqual([{ left: 2 * TRACK_WIDTH, behavior: "smooth" }]);
  });

  it("scrolls to an image when its thumbnail is clicked", () => {
    mountGallery();
    thumbs()[1].click();
    expect(scrolls).toEqual([{ left: 1 * TRACK_WIDTH, behavior: "smooth" }]);
  });

  it("marks the dot the shopper sees, not its tap target", () => {
    mountGallery();
    dots()[1].click();

    expect(pip(1).classList.contains("is-active")).toBe(true);
    expect(pip(0).classList.contains("is-active")).toBe(false);
    expect(dots()[1].classList.contains("is-active")).toBe(false);
  });

  it("marks the matching thumbnail active", () => {
    mountGallery();
    dots()[2].click();

    expect(thumbs()[2].classList.contains("is-active")).toBe(true);
    expect(thumbs()[0].classList.contains("is-active")).toBe(false);
  });

  it("scrolls the other way when the track is right-to-left", () => {
    mountGallery({ rtl: true });
    dots()[2].click();
    expect(scrolls).toEqual([{ left: -2 * TRACK_WIDTH, behavior: "smooth" }]);
  });
});

/**
 * Regression: the shipping-rates bridge used to be delivered synchronously
 * during initProductPage, while `allOffers` and the other later `const`
 * bindings were still in the temporal dead zone. The resulting
 * ReferenceError killed the whole init — the wilaya change listener in
 * bindDeliveryFields was never attached, so communes never loaded.
 */
describe("Shipping rates bridge", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container?.parentNode?.removeChild(container);
  });

  it("initializes cleanly when rates are already on the page", async () => {
    container.innerHTML = `
      <div id="page-data"
        data-variants="[]"
        data-base-price="2500"
        data-cur="DA"
        data-is-rtl="0"
        data-shipping-calc="Calculated at checkout"
        data-shipping-free="Free"
        data-commune-placeholder="Commune"
        data-commune-loading="Loading"
        data-commune-disabled="Pick a wilaya"
        data-offers="[]"></div>
      <div id="shipping-rates-data" data-rates='{"16":{"home":400,"stopDesk":250}}'></div>
      <div id="summary-shipping"></div>
      <div id="summary-total"></div>
      <input id="f-wilaya" value="16" />
    `;

    let initError: unknown = null;
    try {
      initProductPage();
    } catch (e) {
      initError = e;
    }
    expect(initError).toBeNull();

    // The deferred first delivery re-prices against the bridge's rates for
    // the pre-selected wilaya (16 → home 400).
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.getElementById("summary-shipping")!.textContent).toContain("400");
  });
});

/**
 * The product page's delivery is the server's quote for the order its form
 * would post — the same lines, offer and destination — not the rate table's
 * guess. These pin what the shopper sees while that answer is on its way, once
 * it lands, and when the store does not deliver there.
 */
describe("Delivery quote for the product form", () => {
  let container: HTMLElement;

  function build(options: { quantityPriced?: boolean; wilaya?: string; tiers?: string; coupon?: boolean } = {}): void {
    container.innerHTML = `
      <div id="page-data"
        data-quantity-priced="${options.quantityPriced ? "1" : "0"}"
        data-product-id="p1"
        data-product-name="Watch"
        data-variants="[]"
        data-base-price="2500"
        data-cur="DA"
        data-is-rtl="0"
        data-shipping-calc="Calculated at checkout"
        data-shipping-free="Free"
        data-shipping-unavailable="Not delivered to this address"
        data-commune-placeholder="Commune"
        data-commune-loading="Loading"
        data-commune-disabled="Pick a wilaya"
        data-offers="[]"></div>
      <div id="shipping-rates-data" data-rates='{"16":{"home":400,"stopDesk":250}}'></div>
      <div id="summary-item-price"></div>
      <div id="summary-coupon-row" data-label-template="Coupon {code}" hidden><span data-coupon-label></span><span data-coupon-amount></span></div>
      <div id="summary-shipping"></div>
      <div id="summary-total"></div>
      ${options.tiers ?? ""}
      ${options.coupon ? `<input id="f-phone" value="" />
      <div data-coupon-field data-coupon-copy='{"couponApplied":"Code applied: {amount} off","couponExpired":"Expired"}' data-currency="DA" data-checking="Checking">
        <button type="button" data-coupon-toggle></button>
        <div data-coupon-box hidden><input name="couponCode" /><button type="button" data-coupon-apply></button><div data-coupon-status-row hidden><p data-coupon-status><span data-coupon-text></span></p><button type="button" data-coupon-remove hidden>Remove</button></div></div>
      </div>` : ""}
      <input id="f-wilaya" value="${options.wilaya ?? "16"}" />
      <div id="delivery-type-group">
        <label class="delivery-radio-label">
          <input type="radio" name="deliveryType" value="home" class="delivery-radio-input" checked />
          <div></div>
        </label>
        <label class="delivery-radio-label">
          <input type="radio" name="deliveryType" value="stop_desk" class="delivery-radio-input" />
          <div></div>
        </label>
      </div>
      <div id="address-field-container"><input id="f-address" /></div>
      <form method="POST" id="checkout-form">
        <input type="hidden" name="pricePerUnit" id="price-input" />
        <input type="hidden" name="variantId" id="variant-id-input" />
        <input type="hidden" name="variantLabel" id="variant-label-input" />
        <input type="hidden" name="variantSelections" id="variant-selections-input" value="[]" />
        <input type="hidden" name="offerId" id="offer-id-input" value="" />
        <input type="number" name="quantity" id="qty-input" value="1" />
        <button type="submit" id="submit-btn">Confirm</button>
      </form>
    `;
  }

  /** A quote server: `answer` decides each request's reply, in the order requested. */
  function quoteServer(answer: (body: any) => unknown) {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const data = served(answer(body) as Record<string, unknown>);
      return { ok: true, json: async () => ({ success: true, data }) } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const shipping = () => document.getElementById("summary-shipping")!.textContent ?? "";
  const total = () => document.getElementById("summary-total")!.textContent ?? "";
  const itemPrice = () => document.getElementById("summary-item-price")!.textContent ?? "";
  const submit = () => document.getElementById("submit-btn") as HTMLButtonElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container?.parentNode?.removeChild(container);
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it("asks for a quote with the product's own form and the chosen destination", async () => {
    build();
    const fetchMock = quoteServer(() => ({ subtotal: 2500, lines: [], delivery: { available: true, fee: 900, total: 3400 } }));
    initProductPage();
    await settle();

    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).toMatchObject({
      productId: "p1",
      productName: "Watch",
      quantity: 1,
      destination: { wilayaId: 16, deliveryType: "home" },
    });
  });

  it("shows the fee the order will charge, and the total with it", async () => {
    build();
    quoteServer(() => ({ subtotal: 2500, lines: [], delivery: { available: true, fee: 900, total: 3400 } }));
    initProductPage();
    await settle();

    expect(shipping()).toContain("900");
    expect(total()).toContain("3");
    expect(total()).toContain("400");
    expect(submit().disabled).toBe(false);
  });

  it("re-quotes for the new quantity, and never shows the answer to an older one", async () => {
    build();
    const answers: Array<() => Promise<void>> = [];
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      return new Promise<Response>((resolve) => {
        answers.push(async () =>
          resolve({
            ok: true,
            json: async () => ({
              success: true,
              data: served({ subtotal: 0, lines: [], delivery: { available: true, fee: body.quantity === 1 ? 900 : 300, total: 0 } }),
            }),
          } as unknown as Response),
        );
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    initProductPage();
    await settle();

    const qty = document.getElementById("qty-input") as HTMLInputElement;
    qty.value = "2";
    qty.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();

    // The newer answer (quantity 2) lands first; the older one (quantity 1) arrives late.
    await answers[1]();
    await settle();
    await answers[0]();
    await settle();

    expect(shipping()).toContain("300");
    expect(shipping()).not.toContain("900");
  });

  it("says when the store does not deliver there, and holds the order back", async () => {
    build();
    quoteServer(() => ({ subtotal: 2500, lines: [], delivery: { available: false, fee: null, total: null } }));
    initProductPage();
    await settle();

    expect(shipping()).toBe("Not delivered to this address");
    expect(total()).toContain("2");
    expect(total()).not.toContain("400");
    expect(submit().disabled).toBe(true);
  });

  it("asks for the subtotal before a destination is chosen, sending none", async () => {
    build({ wilaya: "" });
    const fetchMock = quoteServer(() => ({ subtotal: 2500, lines: [] }));
    initProductPage();
    await settle();

    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).toMatchObject({ productId: "p1", quantity: 1 });
    expect(body).not.toHaveProperty("destination");
  });

  it("shows the server's subtotal for the lines, not the unit price times the quantity", async () => {
    build();
    quoteServer(() => ({ subtotal: 1999, lines: [], delivery: { available: true, fee: 900, total: 2899 } }));
    initProductPage();
    await settle();

    expect(itemPrice()).toContain("1");
    expect(itemPrice()).toContain("999");
    expect(total()).toContain("899");
  });

  it("under quantity pricing, shows no figure of its own until the server prices the quantity", async () => {
    build({ quantityPriced: true });
    const answers: Array<() => void> = [];
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => {
      answers.push(() => resolve({ ok: true, json: async () => ({ success: true, data: served({ subtotal: 3500, lines: [], delivery: { available: true, fee: 0, total: 3500 } }) }) } as unknown as Response));
    })));
    initProductPage();
    await settle();

    expect(itemPrice()).toBe("…");
    expect(total()).toBe("…");
    expect(itemPrice()).not.toContain("2");

    answers[0]!();
    await settle();
    expect(itemPrice()).toContain("500");
    expect(itemPrice()).toContain("3");
  });

  it("shows what the chosen quantity costs in the sticky bar, not the price of one piece", async () => {
    build({ tiers: `<b id="sticky-price">2 500</b>` });
    quoteServer((body) => ({ subtotal: body.quantity * 2500 - (body.quantity > 1 ? 500 : 0), lines: [], delivery: { available: true, fee: 400, total: 0 } }));
    initProductPage();
    await settle();
    const sticky = () => document.getElementById("sticky-price")!.textContent ?? "";
    expect(sticky()).toContain("2");
    expect(sticky()).toContain("500");

    const qty = document.getElementById("qty-input") as HTMLInputElement;
    qty.value = "3";
    qty.dispatchEvent(new Event("input", { bubbles: true }));
    expect(sticky()).toContain("7");
    expect(sticky()).toContain("500");
    await settle();
    expect(sticky()).toContain("7");
    expect(sticky()).toContain("000");
  });

  it("under quantity pricing, the sticky bar keeps its figure until the server prices the quantity", async () => {
    build({ quantityPriced: true, tiers: `<b id="sticky-price">2 500</b>` });
    const answers: Array<() => void> = [];
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => {
      answers.push(() => resolve({ ok: true, json: async () => ({ success: true, data: served({ subtotal: 4500, lines: [], delivery: { available: true, fee: 0, total: 4500 } }) }) } as unknown as Response));
    })));
    initProductPage();
    await settle();
    expect(document.getElementById("sticky-price")!.textContent).toBe("2 500");

    answers[0]!();
    await settle();
    expect(document.getElementById("sticky-price")!.textContent).toContain("4");
    expect(document.getElementById("sticky-price")!.textContent).toContain("500");
  });

  it("orders a tier's quantity from its tile, and marks the tile the quantity matches", async () => {
    build({
      quantityPriced: true,
      tiers: `<button type="button" class="qty-tier" data-qty="1" aria-checked="false"></button>
              <button type="button" class="qty-tier" data-qty="3" aria-checked="false"></button>`,
    });
    const fetchMock = quoteServer((body) => ({ subtotal: body.quantity === 3 ? 4500 : 2000, lines: [], delivery: { available: true, fee: 400, total: 0 } }));
    initProductPage();
    await settle();

    const [one, three] = Array.from(document.querySelectorAll<HTMLButtonElement>(".qty-tier"));
    expect(one!.getAttribute("aria-checked")).toBe("true");
    three!.click();
    await settle();

    expect((document.getElementById("qty-input") as HTMLInputElement).value).toBe("3");
    expect(three!.getAttribute("aria-checked")).toBe("true");
    expect(one!.getAttribute("aria-checked")).toBe("false");
    expect(JSON.parse(String((fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit])[1].body)).quantity).toBe(3);
    expect(itemPrice()).toContain("500");

    const qty = document.getElementById("qty-input") as HTMLInputElement;
    qty.value = "2";
    qty.dispatchEvent(new Event("input", { bubbles: true }));
    expect(three!.getAttribute("aria-checked")).toBe("false");
  });

  it("asks the quote with the code applied and the phone, and shows what the code took off", async () => {
    build({ coupon: true });
    const fetchMock = quoteServer((body) =>
      body.couponCode
        ? { subtotal: 2250, lines: [], coupon: { code: "DIX", applied: true, discount: 250, freeShipping: false }, delivery: { available: true, fee: 400, total: 2650 } }
        : { subtotal: 2500, lines: [], delivery: { available: true, fee: 400, total: 2900 } },
    );
    initProductPage();
    await settle();
    expect(document.getElementById("summary-coupon-row")!.hidden).toBe(true);

    (document.getElementById("f-phone") as HTMLInputElement).value = "+213 551 00 00 01";
    (document.querySelector('input[name="couponCode"]') as HTMLInputElement).value = "dix";
    (document.querySelector("[data-coupon-apply]") as HTMLButtonElement).click();
    await settle();

    const body = JSON.parse(String((fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit])[1].body));
    expect(body).toMatchObject({ couponCode: "dix", phone: "0551000001", destination: { wilayaId: 16 } });
    expect(itemPrice()).toMatch(/2.500/);
    const row = document.getElementById("summary-coupon-row")!;
    expect(row.hidden).toBe(false);
    expect(row.textContent).toMatch(/Coupon DIX/);
    expect(row.textContent).toMatch(/250/);
    expect(total()).toMatch(/2.650/);
    expect(document.querySelector("[data-coupon-status]")!.textContent).toMatch(/250/);
  });

  it("says free delivery for a free-delivery code, with no coupon row to subtract", async () => {
    build({ coupon: true });
    quoteServer((body) => ({
      subtotal: 2500,
      lines: [],
      ...(body.couponCode ? { coupon: { code: "LIV", applied: true, discount: 0, freeShipping: true } } : {}),
      delivery: { available: true, fee: body.couponCode ? 0 : 400, total: 2500 },
    }));
    initProductPage();
    (document.querySelector('input[name="couponCode"]') as HTMLInputElement).value = "LIV";
    (document.querySelector("[data-coupon-apply]") as HTMLButtonElement).click();
    await settle();

    expect(document.getElementById("summary-coupon-row")!.hidden).toBe(true);
    expect(shipping()).toBe("Free");
    expect(itemPrice()).toMatch(/2.500/);
  });

  it("asks again with the phone once it is typed, while a code is applied", async () => {
    build({ coupon: true });
    const fetchMock = quoteServer(() => ({ subtotal: 2500, lines: [], coupon: { code: "VIP", applied: false, reason: "expired" }, delivery: { available: true, fee: 400, total: 2900 } }));
    initProductPage();
    (document.querySelector('input[name="couponCode"]') as HTMLInputElement).value = "VIP";
    (document.querySelector("[data-coupon-apply]") as HTMLButtonElement).click();
    await settle();
    expect(document.querySelector("[data-coupon-status]")!.textContent).toBe("Expired");
    const before = fetchMock.mock.calls.length;

    const phone = document.getElementById("f-phone") as HTMLInputElement;
    phone.value = "0551000002";
    phone.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(fetchMock.mock.calls.length).toBe(before + 1);
    expect(JSON.parse(String((fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit])[1].body))).toMatchObject({ couponCode: "VIP", phone: "0551000002" });
  });

  it("keeps the rate table's figure when the server predates quotes", async () => {
    build();
    quoteServer(() => ({ subtotal: 2500, lines: [], freeDelivery: { fromOffer: false, threshold: null, qualified: false, remaining: 0 } }));
    initProductPage();
    await settle();

    expect(shipping()).toContain("400");
    expect(submit().disabled).toBe(false);
  });
});

/**
 * S9 — the direct (single-product) checkout form.
 *
 * The product page is the other checkout: no basket, one native POST. These
 * tests pin what the migration must not have changed — a delivery change
 * re-prices the summary from the server's rate table, the posted price follows
 * the selected variant, and the script never builds or sends an order body
 * (the native submit carries it; the action whitelist and cod-server price it).
 */
describe("Direct checkout form (S9)", () => {
  let container: HTMLElement;

  function buildDirectCheckoutDom(options: { variants?: string } = {}): void {
    container.innerHTML = `
      <div id="page-data"
        data-variants='${options.variants ?? "[]"}'
        data-base-price="2500"
        data-cur="DA"
        data-is-rtl="0"
        data-shipping-calc="Calculated at checkout"
        data-shipping-free="Free"
        data-commune-placeholder="Commune"
        data-commune-loading="Loading"
        data-commune-disabled="Pick a wilaya"
        data-offers="[]"></div>

      <div id="shipping-rates-data" data-rates='{"16":{"home":400,"stopDesk":250}}'></div>
      <div id="summary-shipping"></div>
      <div id="summary-total"></div>
      <input id="f-wilaya" value="16" />

      <div id="delivery-type-group">
        <label class="delivery-radio-label">
          <input type="radio" name="deliveryType" value="home" class="delivery-radio-input" checked />
          <div></div>
        </label>
        <label class="delivery-radio-label">
          <input type="radio" name="deliveryType" value="stop_desk" class="delivery-radio-input" />
          <div></div>
        </label>
      </div>
      <div id="address-field-container"><input id="f-address" /></div>

      <form method="POST" id="checkout-form">
        <input type="hidden" name="pricePerUnit" id="price-input" />
        <input type="hidden" name="variantId" id="variant-id-input" />
        <input type="hidden" name="variantLabel" id="variant-label-input" />
        <input type="hidden" name="variantSelections" id="variant-selections-input" value="[]" />
        <input type="number" name="quantity" id="qty-input" value="1" />
        <button type="submit" id="submit-btn">Confirm</button>
      </form>
    `;
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container?.parentNode?.removeChild(container);
    vi.unstubAllGlobals();
  });

  it("a delivery-type change re-prices the summary from the rate table", async () => {
    buildDirectCheckoutDom();
    initProductPage();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.getElementById("summary-shipping")!.textContent).toContain("400");

    const stopDesk = document.querySelector<HTMLInputElement>(
      ".delivery-radio-input[value='stop_desk']"
    )!;
    stopDesk.checked = true;
    stopDesk.dispatchEvent(new Event("change", { bubbles: true }));

    expect(document.getElementById("summary-shipping")!.textContent).toContain("250");
  });

  it("the posted price follows the selected variant, not a stale one", () => {
    buildDirectCheckoutDom({
      variants: JSON.stringify([
        { id: "v1", price: 1000, compareAtPrice: null, inventory: 10, variations: { Color: "Red" }, isDefault: true, active: true, position: 0, imageId: null },
        { id: "v2", price: 1200, compareAtPrice: null, inventory: 10, variations: { Color: "Blue" }, isDefault: false, active: true, position: 1, imageId: null },
      ]),
    });
    container.insertAdjacentHTML(
      "beforeend",
      `<button class="variant-opt" data-option="Color" data-value="Red">Red</button>
       <button class="variant-opt" data-option="Color" data-value="Blue">Blue</button>`
    );

    initProductPage();
    // The default variant seeds the posted fields.
    expect((document.getElementById("price-input") as HTMLInputElement).value).toBe("1000");

    document.querySelector<HTMLButtonElement>(".variant-opt[data-value='Blue']")!.click();
    expect((document.getElementById("price-input") as HTMLInputElement).value).toBe("1200");
    expect((document.getElementById("variant-id-input") as HTMLInputElement).value).toBe("v2");

    // …and switching back leaves no stale price behind.
    document.querySelector<HTMLButtonElement>(".variant-opt[data-value='Red']")!.click();
    expect((document.getElementById("price-input") as HTMLInputElement).value).toBe("1000");
    expect((document.getElementById("variant-id-input") as HTMLInputElement).value).toBe("v1");
  });

  it("the form submits natively — the script never builds or sends the order", () => {
    buildDirectCheckoutDom();
    // Any fetch at all would mean the script is posting something itself.
    const fetchSpy = vi.fn(async () => new Response("{}", { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchSpy);

    initProductPage();

    const form = document.getElementById("checkout-form") as HTMLFormElement;
    const event = new Event("submit", { bubbles: true, cancelable: true });
    form.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});


/**
 * The option buttons always show a variant that exists — the one the order
 * posts — for the page's own buttons and for each unit of an offer.
 */
describe("Option buttons and the variant ordered", () => {
  let container: HTMLElement;

  /** A shirt made in white M, black M and blue L only. */
  const shirt = (overrides: Record<string, Partial<{ inventory: number; isDefault: boolean }>> = {}) =>
    [
      { id: "white-m", variations: { Colour: "White", Size: "M" }, position: 0 },
      { id: "black-m", variations: { Colour: "Black", Size: "M" }, position: 1 },
      { id: "blue-l", variations: { Colour: "Blue", Size: "L" }, position: 2 },
    ].map((v) => ({ price: 2800, compareAtPrice: null, inventory: 5, isDefault: false, active: true, imageId: null, ...v, ...overrides[v.id] }));

  const options = [
    { name: "Colour", values: [{ value: "White" }, { value: "Black" }, { value: "Blue" }] },
    { name: "Size", values: [{ value: "S" }, { value: "M" }, { value: "L" }] },
  ];

  const pills = (cls: string, extra = "") =>
    options.flatMap((o) => o.values.map((v) => `<button type="button" class="${cls}" ${extra} data-option="${o.name}" data-value="${v.value}">${v.value}</button>`)).join("");

  function build(o: { variants?: unknown[]; offers?: unknown[]; tiers?: string; inventory?: number } = {}) {
    container.innerHTML = `
      <div id="page-data" data-product-id="p1" data-product-name="Shirt"
        data-variants='${JSON.stringify(o.variants ?? shirt())}'
        data-variant-options='${JSON.stringify(o.variants?.length === 0 ? [] : options)}'
        data-track-inventory="1" data-inventory="${o.inventory ?? 15}"
        data-base-price="2800" data-cur="DA" data-is-rtl="0" data-out-of-stock-label="Sold out"
        data-offers='${JSON.stringify(o.offers ?? [])}'></div>
      ${o.tiers ?? pills("variant-opt")}
      <form method="POST">
        <input type="hidden" id="price-input" />
        <input type="hidden" id="variant-id-input" />
        <input type="hidden" id="variant-label-input" />
        <input type="hidden" id="variant-selections-input" value="[]" />
        <input type="hidden" id="offer-id-input" value="" />
        <input type="number" id="qty-input" value="1" />
        <button type="submit" id="submit-btn">Confirm</button>
      </form>`;
  }

  const variantId = () => (document.getElementById("variant-id-input") as HTMLInputElement).value;
  const submit = () => document.getElementById("submit-btn") as HTMLButtonElement;
  const pill = (option: string, value: string, scope = ".variant-opt") => document.querySelector<HTMLButtonElement>(`${scope}[data-option="${option}"][data-value="${value}"]`)!;
  const shown = (scope = ".variant-opt") =>
    Object.fromEntries([...document.querySelectorAll<HTMLButtonElement>(`${scope}.is-selected`)].map((b) => [b.dataset.option, b.dataset.value]));

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("offline"))));
  });

  afterEach(() => {
    container.remove();
    vi.unstubAllGlobals();
  });

  it("opens on the default variant, its values the buttons shown, each value with its state", () => {
    build({ variants: shirt({ "black-m": { isDefault: true } }) });
    initProductPage();
    expect(variantId()).toBe("black-m");
    expect(shown()).toEqual({ Colour: "Black", Size: "M" });
    expect(pill("Colour", "White").dataset.state).toBe("available");
    expect(pill("Colour", "Blue").dataset.state).toBe("unavailable");
    expect(pill("Size", "S").dataset.state).toBe("unavailable");
    expect(pill("Size", "M").getAttribute("aria-pressed")).toBe("true");
  });

  it("opens on a variant that can be sold when the default is sold out", () => {
    build({ variants: shirt({ "white-m": { isDefault: true, inventory: 0 } }) });
    initProductPage();
    expect(variantId()).toBe("black-m");
    expect(submit().disabled).toBe(false);
    expect(pill("Colour", "White").dataset.state).toBe("sold_out");
  });

  it("a value that does not combine moves to the variant that has it — shown and ordered the same", () => {
    build();
    initProductPage();
    pill("Colour", "Blue").click();
    expect(variantId()).toBe("blue-l");
    expect(shown()).toEqual({ Colour: "Blue", Size: "L" });
    pill("Size", "M").click();
    expect(variantId()).toBe("white-m");
    expect(shown()).toEqual({ Colour: "White", Size: "M" });
  });

  it("a value no variant has changes nothing", () => {
    build();
    initProductPage();
    pill("Size", "S").click();
    expect(variantId()).toBe("white-m");
    expect(shown()).toEqual({ Colour: "White", Size: "M" });
  });

  it("a sold-out value can be chosen, and the order button says so until another is", () => {
    build({ variants: shirt({ "black-m": { inventory: 0 } }) });
    initProductPage();
    pill("Colour", "Black").click();
    expect(variantId()).toBe("black-m");
    expect(submit().disabled).toBe(true);
    expect(submit().textContent).toBe("Sold out");
    pill("Colour", "White").click();
    expect(submit().disabled).toBe(false);
    expect(submit().textContent).toBe("Confirm");
  });

  describe("an offer's units", () => {
    const offer = (extra: Record<string, unknown> = {}) => ({ id: "o2", discountType: "free", triggerQuantity: 2, triggerVariantId: null, rewardQuantity: 1, rewardProductName: "Shirt", rewardVariantLabel: null, ...extra });
    const tiers = (o: { locked?: { Colour: string; Size: string } } = {}) => `
      <label id="tier-card-base" class="tier-label" data-qty="1" data-offer-id=""></label>
      <label id="tier-card-o2" class="tier-label" data-qty="2" data-offer-id="o2"></label>
      <div id="tier-variants-base">${pills("variant-opt")}</div>
      <div id="tier-variants-o2">${[0, 1]
        .map((unit) =>
          o.locked
            ? Object.entries(o.locked).map(([name, value]) => `<button type="button" class="tier-unit-opt is-locked" data-tier-id="o2" data-unit="${unit}" data-option="${name}" data-value="${value}"></button>`).join("")
            : pills("tier-unit-opt", `data-tier-id="o2" data-unit="${unit}"`),
        )
        .join("")}</div>`;
    const unitPill = (unit: number, option: string, value: string) => pill(option, value, `.tier-unit-opt[data-unit="${unit}"]`);
    const selections = () => JSON.parse((document.getElementById("variant-selections-input") as HTMLInputElement).value).map((s: { variantId: string }) => s.variantId);

    it("orders one variant per unit — every unit, each a variant that exists", () => {
      build({ offers: [offer()], tiers: tiers() });
      initProductPage();
      pill("Colour", "Black").click();
      document.getElementById("tier-card-o2")!.click();
      expect(selections()).toEqual(["black-m", "black-m"]);
      expect(shown(`.tier-unit-opt[data-unit="0"]`)).toEqual({ Colour: "Black", Size: "M" });

      unitPill(1, "Size", "L").click();
      expect(selections()).toEqual(["black-m", "blue-l"]);
      expect(shown(`.tier-unit-opt[data-unit="1"]`)).toEqual({ Colour: "Blue", Size: "L" });
      expect(shown(`.tier-unit-opt[data-unit="0"]`)).toEqual({ Colour: "Black", Size: "M" });

      unitPill(0, "Size", "S").click();
      expect(selections()).toEqual(["black-m", "blue-l"]);
    });

    it("a unit chosen sold out holds the order back", () => {
      build({ variants: shirt({ "blue-l": { inventory: 0 } }), offers: [offer()], tiers: tiers() });
      initProductPage();
      document.getElementById("tier-card-o2")!.click();
      expect(submit().disabled).toBe(false);
      unitPill(1, "Colour", "Blue").click();
      expect(selections()).toEqual(["white-m", "blue-l"]);
      expect(unitPill(1, "Colour", "Blue").dataset.state).toBe("sold_out");
      expect(submit().disabled).toBe(true);
      unitPill(1, "Colour", "Black").click();
      expect(submit().disabled).toBe(false);
    });

    it("an offer locked to a variant orders that variant for every unit", () => {
      build({ variants: shirt({ "blue-l": { isDefault: true } }), offers: [offer({ triggerVariantId: "blue-l" })], tiers: tiers({ locked: { Colour: "Blue", Size: "L" } }) });
      initProductPage();
      document.getElementById("tier-card-o2")!.click();
      expect(selections()).toEqual(["blue-l", "blue-l"]);
    });

    it("the base tier posts no units", () => {
      build({ offers: [offer()], tiers: tiers() });
      initProductPage();
      document.getElementById("tier-card-o2")!.click();
      document.getElementById("tier-card-base")!.click();
      expect(selections()).toEqual([]);
    });
  });

  it("a sold-out choice takes out every quantity tile", () => {
    build({ variants: shirt({ "black-m": { inventory: 0 } }), tiers: pills("variant-opt") + [1, 2, 3].map((q) => `<button type="button" class="qty-tier" data-qty="${q}"></button>`).join("") });
    initProductPage();
    const tiles = () => [...document.querySelectorAll<HTMLButtonElement>(".qty-tier")].map((t) => t.disabled);
    expect(tiles()).toEqual([false, false, false]);
    pill("Colour", "Black").click();
    expect(tiles()).toEqual([true, true, true]);
    pill("Colour", "White").click();
    expect(tiles()).toEqual([false, false, false]);
  });

  it("a sold-out product without variants keeps its order button held when the quote answers", async () => {
    build({ variants: [], inventory: 0, tiers: " " });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ success: true, data: served({ subtotal: 2800, lines: [], delivery: { available: true, fee: 400, total: 3200 } }) }) }) as unknown as Response));
    container.insertAdjacentHTML("beforeend", `<div id="shipping-rates-data" data-rates='{"16":{"home":400,"stopDesk":250}}'></div><input id="f-wilaya" value="16" />`);
    initProductPage();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(submit().disabled).toBe(true);
  });
});
