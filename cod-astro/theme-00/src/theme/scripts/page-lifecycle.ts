/**
 * Runs a page's behaviour for the page the shopper is on, and again after every
 * client-side navigation (ClientRouter).
 *
 * A module runs once per document, but a soft navigation replaces the body, so
 * each page's controls are bound again to the new elements. `boot` returns its
 * teardown, which runs just before the old body is swapped out: document-level
 * and window-level listeners and timers are removed there, so they never stack
 * up from one page to the next. On a document without ClientRouter, `boot` runs
 * once and nothing else happens.
 */

type Teardown = void | (() => void);

export function onEachPage(boot: () => Teardown): void {
  let mounted: HTMLElement | null = null;
  let teardown: Teardown;

  const unmount = () => {
    const previous = teardown;
    teardown = undefined;
    if (typeof previous === "function") previous();
  };

  const mount = () => {
    mounted = document.body;
    teardown = boot();
  };

  document.addEventListener("astro:before-swap", unmount);
  document.addEventListener("astro:page-load", () => {
    if (document.body === mounted) return;
    unmount();
    mount();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
}
