/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

import type { AdvancedRuntime } from '@astrojs/cloudflare';
import type { PreviewClaims, PreviewDraft } from "./theme/sdk";
import type { StoreContext } from "./theme/runtime/store";

declare global {
  interface CloudflareEnv {
    /** Raw store API key — set as a Cloudflare secret */
    STORE_API_KEY: string;
    /** Base URL of cod-server (e.g. https://api.yourdomain.com). Local: http://localhost:8787 */
    COD_SERVER_URL: string;
    /** Optional editor preview public key (an Ed25519 JWK) — unset, `/wocart-preview` is off */
    WOCART_PREVIEW_KEY?: string;
  }

  namespace App {
    interface Locals {
      // Make Cloudflare runtime optional so build succeeds on Vercel
      runtime?: AdvancedRuntime<Env>;
      /**
       * The store context for this request — set once in `src/middleware.ts`
       * (Theme Zero S2). Pages, layouts and the `/api/*` routes read it;
       * nothing else acquires it. An `/api/*` request takes the language of
       * the page that asked for it.
       */
      store: StoreContext;
      /**
       * Set only on the preview route (`/wocart-preview`), by the middleware,
       * from a verified editor token: what to render and who may frame it.
       */
      preview?: { claims: PreviewClaims; draft: PreviewDraft; token: string };
    }
  }

  interface SelectOption {
    value: string;
    label: string;
  }

  interface Window {
    __selectSetLoading: (id: string, loading: boolean, loadingText: string) => void;
    __selectPopulate: (id: string, options: SelectOption[], placeholder: string) => void;
    __selectSetDisabled: (id: string, disabledText: string) => void;
  }
}
