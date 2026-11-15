/**
 * The landing page a shopper arrived on, credited to the order they place in
 * the same visit — on the landing page's own form, a product page they went
 * on to, or the basket checkout.
 *
 * The landing page writes its slug for the tab (sessionStorage: one visit, one
 * tab, gone when it closes); each order form fills its `landingPageSlug` field
 * from it at submit, unless the page already set it — a landing page's own form
 * always credits itself. Shared by the product/landing form and the basket
 * checkout so the two cannot drift. Storage refused (private mode, blocked
 * site data) only loses the credit, never the order.
 */

const LANDING_KEY = "wocart:landing";

export function rememberLanding(slug: string): void {
  if (!slug) return;
  try {
    sessionStorage.setItem(LANDING_KEY, slug);
  } catch {
    // Attribution is optional.
  }
}

export function landingOfThisVisit(): string | null {
  try {
    return sessionStorage.getItem(LANDING_KEY) || null;
  } catch {
    return null;
  }
}

/** Fills the form's landing page field from the visit, when the page left it empty. */
export function creditLandingOfThisVisit(form: HTMLFormElement | null): void {
  const field = form?.querySelector<HTMLInputElement>('input[name="landingPageSlug"]');
  if (!field || field.value) return;
  field.value = landingOfThisVisit() ?? "";
}
