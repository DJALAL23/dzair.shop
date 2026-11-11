/**
 * Copies the shopper's Meta cookies into an order form's hidden inputs at the
 * moment it is submitted, so the sale carries the ad click to the Conversions
 * API. Read at submit, not at page load: a cookie set later in the visit still
 * travels with the order. The server drops a malformed value; this only reads.
 */
export function bindMetaCookies(form: HTMLFormElement, signal?: AbortSignal): void {
  form.addEventListener(
    "submit",
    () => {
      const fbc = form.querySelector<HTMLInputElement>("#fbc-input");
      const fbp = form.querySelector<HTMLInputElement>("#fbp-input");
      if (fbc) fbc.value = readCookie("_fbc") ?? "";
      if (fbp) fbp.value = readCookie("_fbp") ?? "";
    },
    { signal },
  );
}

/** One cookie's value by its exact name, or null. */
export function readCookie(name: string): string | null {
  for (const part of document.cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0 && part.slice(0, separator).trim() === name) return part.slice(separator + 1) || null;
  }
  return null;
}
