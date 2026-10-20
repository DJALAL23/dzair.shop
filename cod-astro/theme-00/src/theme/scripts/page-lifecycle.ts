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

/** What `@wocart/theme`'s preview dispatches on `document` after it swaps a section in. */
const SECTION_LOAD = "wocart:section-load";

/**
 * Binds `boot` to every element matching `selector`, on each page and again
 * whenever an editor's preview swaps a section in (a swapped section's
 * scripts do not run again). An element is bound once; its teardown runs
 * when the page is left.
 */
export function onEachElement(selector: string, boot: (element: HTMLElement) => Teardown): void {
  const bound = new WeakSet<HTMLElement>();
  let teardowns: Array<() => void> = [];
  const bindAll = () => {
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      if (bound.has(element)) continue;
      bound.add(element);
      const teardown = boot(element);
      if (typeof teardown === "function") teardowns.push(teardown);
    }
  };
  onEachPage(() => {
    bindAll();
    document.addEventListener(SECTION_LOAD, bindAll);
    return () => {
      document.removeEventListener(SECTION_LOAD, bindAll);
      for (const teardown of teardowns) teardown();
      teardowns = [];
    };
  });
}
