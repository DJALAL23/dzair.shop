/**
 * Types for the WhatsApp button App's screen. The button's own shapes are
 * cod-shared's (`whatsapp-widget/config.ts`); only the screen's draft is here.
 */
import type {
  StorefrontWhatsAppWidget,
  WhatsAppWidgetConfig,
  WidgetAccent,
  WidgetPosition,
  WidgetSurfaces,
  WidgetTextFieldKey,
} from "../../../../../cod-shared/whatsapp-widget/config";

export type { WhatsAppWidgetConfig, WidgetSurfaces as WhatsAppWidgetSurfaces };

/** The server's rules for the editor: the text caps, the surfaces in display order, the prefill tokens. */
export interface WhatsAppWidgetCapabilities {
  textFields: Record<WidgetTextFieldKey, { max: number }>;
  surfaces: Record<keyof WidgetSurfaces, { default: boolean }>;
  surfaceOrder: Array<keyof WidgetSurfaces>;
  accents: WidgetAccent[];
  positions: WidgetPosition[];
  prefillTokens: string[];
  limits: Record<string, number>;
}

export interface WhatsAppWidgetResponse {
  config: WhatsAppWidgetConfig;
  /** Where browsers fetch the saved avatar. */
  avatarUrl: string | null;
  /** What the storefront renders from this configuration, in the primary language; null when nothing would. */
  preview: StorefrontWhatsAppWidget | null;
  capabilities: WhatsAppWidgetCapabilities;
}

/** The screen's draft: every text as typed, "" where the merchant leaves the theme's words. */
export interface WhatsAppWidgetDraft extends Record<WidgetTextFieldKey, string> {
  enabled: boolean;
  phone: string;
  /** An uploaded image: its key is saved, its URL shown. */
  avatar: { key: string; url: string } | null;
  accent: WidgetAccent;
  position: WidgetPosition;
  attention: boolean;
  surfaces: WidgetSurfaces;
}

export interface SaveBlocker {
  field: string;
  message: string;
}
