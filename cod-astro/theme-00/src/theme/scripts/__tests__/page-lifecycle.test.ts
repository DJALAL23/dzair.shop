import { describe, expect, it, vi } from "vitest";
import { onEachPage } from "../page-lifecycle";

function swapBody(): void {
  document.body.replaceWith(document.createElement("body"));
}

function navigate(): void {
  document.dispatchEvent(new Event("astro:before-swap"));
  swapBody();
  document.dispatchEvent(new Event("astro:page-load"));
}

describe("onEachPage", () => {
  it("boots the page it is loaded on, and not again for the same body", () => {
    const boot = vi.fn();
    onEachPage(boot);
    expect(boot).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event("astro:page-load"));
    expect(boot).toHaveBeenCalledTimes(1);
  });

  it("tears down the old page and boots the new one on each navigation", () => {
    const teardown = vi.fn();
    const boot = vi.fn(() => teardown);
    onEachPage(boot);
    navigate();
    expect(teardown).toHaveBeenCalledTimes(1);
    expect(boot).toHaveBeenCalledTimes(2);
    navigate();
    expect(teardown).toHaveBeenCalledTimes(2);
    expect(boot).toHaveBeenCalledTimes(3);
  });

  it("runs a teardown once, even when the swap event repeats", () => {
    const teardown = vi.fn();
    onEachPage(() => teardown);
    document.dispatchEvent(new Event("astro:before-swap"));
    document.dispatchEvent(new Event("astro:before-swap"));
    expect(teardown).toHaveBeenCalledTimes(1);
  });

  it("boots a page that has no teardown without error", () => {
    const boot = vi.fn();
    onEachPage(boot);
    expect(() => navigate()).not.toThrow();
    expect(boot.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
