import { describe, expect, it, vi } from "vitest";
import { PREVIEW_PROTOCOL_VERSION, previewEndMarker, previewStartMarker } from "@wocart/theme";
import { startPreviewBridge } from "@wocart/theme/preview";
import { onEachPage } from "@wocart/theme/lifecycle";

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

describe("onEachPage in an editor's preview", () => {
  const EDITOR = "https://cloud.codflow.store";
  const page = (header: string) =>
    `<html><head></head><body><header>${header}</header><!--${previewStartMarker({ id: "hero", type: "hero" })}--><section>Hero</section><!--${previewEndMarker({ id: "hero" })}--></body></html>`;

  it("mounts the page again when the preview replaces the whole page", async () => {
    document.body.innerHTML = new DOMParser().parseFromString(page("Shop"), "text/html").body.innerHTML;
    vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
    vi.spyOn(window, "fetch").mockResolvedValue(new Response(page("New name"), { status: 200 }));
    const teardown = vi.fn();
    const boot = vi.fn(() => teardown);
    onEachPage(boot);
    const bridge = startPreviewBridge({ editorOrigin: EDITOR, token: "t" });

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { source: "wocart-editor", version: PREVIEW_PROTOCOL_VERSION, type: "render", draft: { surface: "home" } },
        origin: EDITOR,
        source: window.parent,
      }),
    );
    await vi.waitFor(() => expect(document.querySelector("header")!.textContent).toBe("New name"));
    bridge.stop();
    vi.restoreAllMocks();

    expect(teardown).toHaveBeenCalledTimes(1);
    expect(boot).toHaveBeenCalledTimes(2);
  });
});
