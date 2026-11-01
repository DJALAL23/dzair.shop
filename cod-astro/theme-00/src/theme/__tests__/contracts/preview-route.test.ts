// @vitest-environment node
/// <reference types="vitest/globals" />
/**
 * The preview route (`/wocart-preview`) rendered through its real page and
 * layout: an editor's draft shows with every section marked for the editor
 * and the bridge that talks to it, framed by that editor only and never
 * stored; without a draft document the saved page shows; anything else is a
 * 404. The shopper's home page, rendered from the same store, carries none of
 * it. And the SDK's bridge, run over this theme's real preview markup, swaps
 * in only the section a draft changed.
 */
import { describe, expect, it, vi } from "vitest";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { Window } from "happy-dom";
import { PREVIEW_PROTOCOL_VERSION, parsePreviewMarker, type ComponentInstance, type PageData, type PreviewPageMessage } from "@wocart/theme";
import { PREVIEW_SECTION_LOAD_EVENT, startPreviewBridge } from "@wocart/theme/preview";
import type { StoreClient } from "@/theme/sdk";
import PreviewPage from "@/pages/wocart-preview.astro";
import HomePage from "@/pages/index.astro";
import { testStore } from "../support/locals";
import { makeProduct } from "../support/home-render";
import shippedHome from "@/theme/pages/home.page.json";

vi.mock("astro:env/server", () => ({
  COD_SERVER_URL: "http://localhost:8787",
  STORE_API_KEY: "test-key",
  WOCART_PREVIEW_KEY: undefined,
}));

// The product page holds server islands, which a container render cannot
// resolve; the route's choice of product is what is checked here, through a
// stand-in that prints what it was given.
vi.mock("@/theme/pages/ProductSurface.astro", async () => {
  const { createComponent, render, renderSlot } = await import("astro/runtime/server/index.js");
  return {
    default: createComponent((result: unknown, props: { product: { name: string }; document: { sections?: Array<{ id: string }> } | null; preview?: boolean }, slots: Record<string, unknown>) =>
      render`<main data-product="${props.product?.name ?? "none"}" data-sections="${(props.document?.sections ?? []).map((section) => section.id).join(",")}" data-preview="${String(props.preview)}">${renderSlot(result as never, slots.default as never)}</main>`,
    ),
  };
});

const EDITOR = "https://cloud.codflow.store";
const claims = { aud: "https://boutique.test", theme: "theme-00", editor: EDITOR, iat: 1, exp: 2 };

const doc = (text: string) => ({ type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const saved: PageData = { version: 1, surface: "home", theme: { key: "theme-00", version: "1.4.0" }, sections: [{ id: "saved_text", type: "rich-text", props: { body: doc("Saved words") } }] };
const draftDocument = {
  version: 1,
  surface: "home",
  theme: { key: "theme-00", version: "1.4.0" },
  sections: [
    { id: "draft_text", type: "rich-text", props: { body: doc("Draft words") } },
    { id: "draft_faq", type: "faq", props: { questions: [{ id: "q1", props: { question: "COD?" } }] } },
    { id: "draft_off", type: "rich-text", hidden: true, props: { body: doc("Switched off") } },
  ],
};

const ROBE = {
  ...makeProduct({ id: "prod_robe", name: "Robe kabyle", handle: "robe-kabyle" }),
  images: [],
  variants: [],
  offers: [],
  category: null,
  tags: [],
  variantOptions: null,
  reviewStats: null,
};

/** A store with its products, categories, collections and text pages; `empty` is a store with none of them yet. */
function store(empty = false) {
  const client = {
    menus: { get: async () => null },
    pageData: { get: async (surface: string) => (surface === "home" ? saved : null) },
    products: {
      list: async () => (empty ? [] : [makeProduct({ handle: "lampe" })]),
      page: async () => ({ items: empty ? [] : [makeProduct({ handle: "lampe" })], hasNext: false, total: empty ? 0 : 1 }),
      get: async (handle: string) => (empty ? null : handle === "robe-kabyle" ? ROBE : handle === "lampe" ? { ...ROBE, name: "Lampe", handle } : null),
    },
    categories: { list: async () => (empty ? [] : [{ id: "cat_robes", name: "Robes", slug: "robes", description: null, parentId: null, image: null, metaTitle: null, metaDescription: null, metaKeywords: null, position: 0, createdAt: "", updatedAt: "" }]) },
    collections: { get: async (handle: string) => (!empty && handle === "best-sellers" ? { handle, title: "Meilleures ventes", description: null } : null) },
    pages: { get: async () => null },
    shipping: { rates: async () => ({}) },
  } as unknown as StoreClient;
  return testStore({ client });
}

async function render(page: unknown, preview?: { draft: Record<string, unknown>; token?: string }, options: { empty?: boolean } = {}) {
  const container = await AstroContainer.create();
  const locals = { store: store(options.empty), ...(preview ? { preview: { claims, token: preview.token ?? "signed-token", draft: preview.draft } } : {}) };
  const response = await container.renderToResponse(page as never, { locals: locals as never, request: new Request("https://boutique.test/wocart-preview") });
  return { response, html: await response.text() };
}

const markers = (html: string) =>
  [...html.matchAll(/<!--([\s\S]*?)-->/g)].map((match) => parsePreviewMarker(match[1]!)).filter((marker) => marker !== null);
const starts = (html: string) => markers(html).flatMap((marker) => (marker.kind === "start" ? [`${marker.id}${marker.hidden ? " (hidden)" : ""}`] : []));

describe("the preview route", () => {
  it("renders the editor's draft, every section marked, with the bridge to that editor", async () => {
    const { response, html } = await render(PreviewPage, { draft: { surface: "home", document: draftDocument } });

    expect(response.status).toBe(200);
    expect(html).toContain("Draft words");
    expect(html).toContain("COD?");
    expect(html).not.toContain("Saved words");
    expect(html).not.toContain("Switched off");
    expect(starts(html)).toEqual(["draft_text", "draft_faq", "draft_off (hidden)"]);
    expect(html).toMatch(new RegExp(`<wocart-preview-bridge[^>]*data-editor="${EDITOR}"[^>]*data-token="signed-token"`));
  });

  it("is framed by that editor only, and never stored or indexed", async () => {
    const { response } = await render(PreviewPage, { draft: { surface: "home" } });
    expect(response.headers.get("Content-Security-Policy")).toBe(`frame-ancestors ${EDITOR}`);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("shows the saved page until the editor sends a document", async () => {
    const { html } = await render(PreviewPage, { draft: { surface: "home" } });
    expect(html).toContain("Saved words");
    expect(starts(html)).toEqual(["saved_text"]);
  });

  it("shows the shipped default for a draft this theme cannot read, as the home page would", async () => {
    const { html } = await render(PreviewPage, { draft: { surface: "home", document: { ...draftDocument, theme: { key: "other-theme", version: "2.0.0" } } } });
    expect(html).not.toContain("Draft words");
    // Every section, then the blocks inside it, in document order.
    const tree = (nodes: readonly ComponentInstance[]): string[] =>
      nodes.flatMap((node) => [`${node.id}${node.hidden ? " (hidden)" : ""}`, ...tree(Object.values(node.slots ?? {}).flat())]);
    expect(starts(html)).toEqual(tree((shippedHome as PageData).sections));
  });

  it("renders a product draft for the product its path names, or the store's first", async () => {
    const draft = { version: 1, surface: "product", sections: [{ id: "draft_main", type: "product-main", props: {} }] };
    for (const [path, name] of [["/products/robe-kabyle", "Robe kabyle"], [undefined, "Lampe"]] as const) {
      const { response, html } = await render(PreviewPage, { draft: { surface: "product", document: draft, ...(path ? { path } : {}) } });
      expect(response.status).toBe(200);
      expect(html).toContain(`data-product="${name}"`);
      expect(html).toContain('data-sections="draft_main"');
      expect(html).toContain('data-preview="true"');
      expect(html).toMatch(/<wocart-preview-bridge/);
    }
  });

  it("shows a header draft on the home page, marking only the header's sections", async () => {
    const header = { version: 1, surface: "area:header", sections: [{ id: "draft_header", type: "header", props: {} }] };
    const { response, html } = await render(PreviewPage, { draft: { surface: "area:header", document: header } });
    expect(response.status).toBe(200);
    expect(html).toContain("Saved words");
    expect(starts(html)).toEqual(["draft_header"]);
    expect(html).toMatch(/<wocart-preview-bridge/);
  });

  it("shows a header draft on the product page its path names", async () => {
    const header = { version: 1, surface: "area:header", sections: [{ id: "draft_header", type: "header", props: {} }] };
    const { response, html } = await render(PreviewPage, { draft: { surface: "area:header", document: header, path: "/products/robe-kabyle" } });
    expect(response.status).toBe(200);
    expect(html).toContain('data-product="Robe kabyle"');
    expect(html).toContain('data-preview="false"');
  });

  it("renders the listing pages: all products, and a category by its path or the store's first", async () => {
    const catalog = await render(PreviewPage, { draft: { surface: "catalog" } });
    expect(catalog.response.status).toBe(200);
    expect(starts(catalog.html)).toEqual(["cmp_a1list", "cmp_a2feat"]);
    for (const path of ["/category/robes", undefined]) {
      const category = await render(PreviewPage, { draft: { surface: "category", ...(path ? { path } : {}) } });
      expect(category.response.status).toBe(200);
      expect(category.html).toContain(">Robes</h1>");
    }
    // A path naming a category that no longer exists previews the store's first one, not an error.
    expect((await render(PreviewPage, { draft: { surface: "category", path: "/category/gone" } })).response.status).toBe(200);
  });

  it("is a 404 without a verified preview, and for a surface this theme does not compose", async () => {
    expect((await render(PreviewPage)).response.status).toBe(404);
    expect((await render(PreviewPage, { draft: { surface: "blog" } })).response.status).toBe(404);
    expect((await render(PreviewPage, { draft: { surface: "area:sidebar" } })).response.status).toBe(404);
  });

  it("previews every page of the store's own — search, order tracking, checkout, contact — with its main section marked", async () => {
    for (const [surface, main] of [["search", "search-main"], ["track-order", "track-order-main"], ["checkout", "checkout-main"], ["contact", "contact-main"]]) {
      const { response, html } = await render(PreviewPage, { draft: { surface } });
      expect(response.status, surface).toBe(200);
      expect(starts(html), surface).toContain(main);
    }
  });

  it("previews a store with no product, category, collection or text page yet: the template renders empty, never an error", async () => {
    const product = await render(PreviewPage, { draft: { surface: "product" } }, { empty: true });
    expect(product.response.status).toBe(200);
    expect(product.html).toContain('data-product="none"');
    const category = await render(PreviewPage, { draft: { surface: "category" } }, { empty: true });
    expect(category.response.status).toBe(200);
    expect(starts(category.html)).toEqual(expect.arrayContaining(["cmp_g1list", "cmp_g2feat"]));
    expect(category.html).not.toContain("chip");
    for (const surface of ["collection", "page"]) {
      const { response, html } = await render(PreviewPage, { draft: { surface } }, { empty: true });
      expect(response.status).toBe(200);
      expect(starts(html)).toEqual(expect.arrayContaining([surface === "page" ? "cmp_t1page" : "cmp_k1list"]));
    }
  });
});

describe("the shopper's home page", () => {
  it("carries no marker and no bridge", async () => {
    const { html } = await render(HomePage);
    expect(html).toContain("Saved words");
    expect(markers(html)).toEqual([]);
    expect(html).not.toContain("wocart-preview-bridge");
  });
});

describe("the bridge over this theme's real preview markup", () => {
  it("re-renders a draft by swapping in only the section it changed", async () => {
    const edited = { ...draftDocument, sections: draftDocument.sections.map((section) => (section.id === "draft_text" ? { ...section, props: { body: doc("Edited words") } } : section)) };
    const first = (await render(PreviewPage, { draft: { surface: "home", document: draftDocument } })).html;
    const second = (await render(PreviewPage, { draft: { surface: "home", document: edited } })).html;

    const win = new Window({
      url: "https://boutique.test/wocart-preview",
      settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true, handleDisabledFileLoadingAsSuccess: true, disableJavaScriptEvaluation: true },
    });
    win.document.write(first);
    const posted: PreviewPageMessage[] = [];
    win.parent.postMessage = ((message: PreviewPageMessage) => posted.push(message)) as typeof win.postMessage;
    const fetch = vi.fn(async () => new win.Response(second, { status: 200, headers: { "Content-Type": "text/html" } }));
    win.fetch = fetch as unknown as typeof win.fetch;
    const loaded: string[] = [];
    win.document.addEventListener(PREVIEW_SECTION_LOAD_EVENT, (event) => loaded.push((event as unknown as CustomEvent<{ id: string }>).detail.id));

    const bridge = startPreviewBridge({ editorOrigin: EDITOR, token: "signed-token", window: win as unknown as globalThis.Window });
    expect(posted[0]).toMatchObject({ type: "ready" });
    expect(posted[0]!.type === "ready" && posted[0]!.instances.map((instance) => instance.id)).toEqual(["draft_text", "draft_faq", "draft_off"]);
    const faq = win.document.querySelector("details");

    win.dispatchEvent(
      new win.MessageEvent("message", {
        data: { source: "wocart-editor", version: PREVIEW_PROTOCOL_VERSION, type: "render", draft: { surface: "home", document: edited }, revision: 1 },
        origin: EDITOR,
        source: win as never,
      }),
    );
    await vi.waitFor(() => expect(posted.at(-1)).toMatchObject({ type: "rendered", revision: 1 }));
    bridge.stop();

    expect(win.document.body.textContent).toContain("Edited words");
    expect(win.document.body.textContent).not.toContain("Draft words");
    expect(loaded).toEqual(["draft_text"]);
    expect(win.document.querySelector("details")).toBe(faq);
    expect(JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ token: "signed-token", draft: { surface: "home", document: edited } });
    await win.happyDOM.close();
  });
});
