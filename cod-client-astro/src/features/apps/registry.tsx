import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from "react";
import { BarChart2, Loader2, Mail, MessageCircle, Send, Shield, ShieldCheck, Star, type LucideIcon } from "lucide-react";
import { Alert, ErrorBoundary } from "@/components/ui";
import { useT } from "@/i18n/react";
import type { AppBodyProps, AppKey } from "./types";

export interface AppEntry {
  icon: LucideIcon;
  /** The App's page body, loaded only on its own page. */
  Body: LazyExoticComponent<ComponentType<AppBodyProps>>;
}

/** Each App's page body and mark. The App Page frames it; the catalog (cod-shared/apps) describes it. */
export const APP_REGISTRY: Record<AppKey, AppEntry> = {
  meta: { icon: BarChart2, Body: lazy(() => import("./meta/MetaApp")) },
  dzverify: { icon: ShieldCheck, Body: lazy(() => import("./dzverify/DZVerifyApp")) },
  turnstile: { icon: Shield, Body: lazy(() => import("./turnstile/TurnstileApp")) },
  sendili: { icon: Mail, Body: lazy(() => import("./sendili/SendiliApp")) },
  "whatsapp-button": { icon: MessageCircle, Body: lazy(() => import("./whatsapp-button/WhatsAppButtonApp")) },
  telegram: { icon: Send, Body: lazy(() => import("./telegram/TelegramApp")) },
  reviews: { icon: Star, Body: lazy(() => import("./reviews/ReviewsApp")) },
};

/** An App's body, loading in place; a body that fails to load or render says so inside the page. */
export function AppBody({ appKey, ...props }: AppBodyProps & { appKey: AppKey }) {
  const common = useT("common");
  const { Body } = APP_REGISTRY[appKey];
  return (
    <ErrorBoundary
      fallback={
        <Alert role="alert" tone="critical">
          {common("load_failed")}
        </Alert>
      }
    >
      <Suspense
        fallback={
          <div role="status" aria-busy="true" className="flex min-h-40 items-center justify-center">
            <Loader2 size={22} className="animate-spin text-muted-foreground" />
          </div>
        }
      >
        <Body {...props} />
      </Suspense>
    </ErrorBoundary>
  );
}
