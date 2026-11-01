/**
 * The theme's one binding to the store's WhatsApp.
 *
 * The WhatsApp button App owns the number, the texts and where the launcher
 * shows; the SDK's `whatsAppContact` resolves them for a page. This module
 * only says what this theme's words are — what each text the merchant left
 * empty reads, in the page's language — so the launcher, the footer, the
 * home band, the contact page, the thank-you and tracking buttons all speak
 * the same way. No component writes a WhatsApp link itself.
 */
import { whatsAppContact, type WhatsAppContact, type WhatsAppPage, type WhatsAppWords } from "@wocart/storefront";
import type { StoreContext } from "@/theme/runtime/store";

/** This theme's words for the store's WhatsApp, from the page's content pack. The launcher shows its icon alone unless the merchant names it. */
export function whatsappWords(content: StoreContext["content"]): WhatsAppWords {
  return {
    launcher: null,
    caption: content.waCaptionDefault,
    welcome: content.waWelcomeDefault,
    cta: content.waCtaDefault,
    orderButton: content.waThankYouButtonDefault,
    messages: { general: content.waPrefillGeneralDefault, product: content.waPrefillProductDefault, order: content.waPrefillThankYouDefault },
  };
}

/** The store's WhatsApp on this page, or null when it has none; `words` replaces the theme's own where one place says it differently. */
export function storeWhatsApp(store: Pick<StoreContext, "config" | "content">, page: WhatsAppPage, words: Partial<WhatsAppWords> = {}): WhatsAppContact | null {
  return whatsAppContact(store.config, page, { ...whatsappWords(store.content), ...words });
}
