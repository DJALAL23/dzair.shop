/**
 * WhatsApp chat widget client script (theme layer).
 * Idempotent, accessible, zero dependencies.
 *
 * Implements:
 * - Launcher toggle + close button
 * - Escape key dismissal + focus return to launcher
 * - Click-outside dismissal
 * - One-time session attention pulse (~8s) suppressed under reduced motion
 * - Steps aside while an order form runs under it, so it never covers the form
 */

import { onEachPage } from "@wocart/theme/lifecycle";

export function initWhatsAppWidget(
  container: HTMLElement | null = document.getElementById("wa-widget"),
): (() => void) | void {
  const root = container;
  if (!root) return;
  if (root.dataset.waInitialized === "true") return;
  root.dataset.waInitialized = "true";

  const launcher = root.querySelector<HTMLButtonElement>("#wa-launcher");
  const panel = root.querySelector<HTMLElement>("#wa-panel");
  const closeBtn = root.querySelector<HTMLButtonElement>("#wa-close");
  const ctaBtn = root.querySelector<HTMLAnchorElement>("#wa-cta");

  if (!launcher || !panel || !closeBtn || !ctaBtn) return;

  const rootEl = root;
  const launcherEl = launcher;
  const panelEl = panel;
  const closeBtnEl = closeBtn;
  const ctaBtnEl = ctaBtn;

  const attentionEnabled = rootEl.dataset.attention === "true";

  let pulseTimer: ReturnType<typeof setTimeout> | null = null;

  function dismissPulse() {
    launcherEl.classList.remove("has-pulse");
    try {
      sessionStorage.setItem("wa_pulse_seen", "1");
    } catch {
      // Ignore private browsing restrictions
    }
  }

  // Attention pulse: ~8s after load, once per session, suppressed under prefers-reduced-motion
  if (attentionEnabled) {
    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let alreadySeen = false;
    try {
      alreadySeen = sessionStorage.getItem("wa_pulse_seen") === "1";
    } catch {
      alreadySeen = false;
    }

    if (!reducedMotion && !alreadySeen) {
      pulseTimer = setTimeout(() => {
        if (!panelEl.hasAttribute("data-open")) {
          launcherEl.classList.add("has-pulse");
        }
      }, 8000);
    }
  }

  function openPanel() {
    dismissPulse();
    panelEl.hidden = false;
    panelEl.setAttribute("data-open", "true");
    launcherEl.setAttribute("aria-expanded", "true");
    closeBtnEl.focus();
  }

  function closePanel() {
    panelEl.hidden = true;
    panelEl.removeAttribute("data-open");
    launcherEl.setAttribute("aria-expanded", "false");
    launcherEl.focus();
  }

  function onLauncherClick() {
    if (panelEl.hasAttribute("data-open")) {
      closePanel();
    } else {
      openPanel();
    }
  }

  function onCloseClick() {
    closePanel();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape" && panelEl.hasAttribute("data-open")) {
      closePanel();
    }
  }

  function onDocumentClick(e: MouseEvent) {
    if (!panelEl.hasAttribute("data-open")) return;
    const target = e.target as Node;
    if (!rootEl.contains(target)) {
      closePanel();
    }
  }

  function onCtaClick() {
    dismissPulse();
  }

  // The closed launcher steps aside while an order form runs under it: in the
  // screen's bottom band, on the launcher's side.
  const forms = document.querySelectorAll("form.order-form, #checkout-form");
  const underLauncher = new Set<Element>();
  const besideLauncher = (form: Element) => {
    const a = form.getBoundingClientRect();
    const b = launcherEl.getBoundingClientRect();
    return a.left < b.right && a.right > b.left;
  };
  const watch =
    forms.length > 0 && "IntersectionObserver" in window
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (entry.isIntersecting && besideLauncher(entry.target)) underLauncher.add(entry.target);
              else underLauncher.delete(entry.target);
            }
            rootEl.dataset.yield = String(underLauncher.size > 0 && panelEl.hidden);
          },
          { rootMargin: "-80% 0px 0px 0px" },
        )
      : null;
  forms.forEach((form) => watch?.observe(form));

  // Bind event listeners
  launcherEl.addEventListener("click", onLauncherClick);
  closeBtnEl.addEventListener("click", onCloseClick);
  ctaBtnEl.addEventListener("click", onCtaClick);
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("click", onDocumentClick);

  // Return teardown
  return () => {
    if (pulseTimer) clearTimeout(pulseTimer);
    watch?.disconnect();
    launcherEl.removeEventListener("click", onLauncherClick);
    closeBtnEl.removeEventListener("click", onCloseClick);
    ctaBtnEl.removeEventListener("click", onCtaClick);
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("click", onDocumentClick);
    delete rootEl.dataset.waInitialized;
  };
}

onEachPage(() => initWhatsAppWidget());
