/**
 * Presentation logic for the WhatsApp button App's screen.
 * Pure model: no API imports, fully unit-testable.
 *
 * An empty text is saved as null, which a storefront reads as its theme's own
 * words in the page's language — never as the screen's example text.
 */

import { normalizeAlgerianPhone } from "../../../../../cod-shared/lib/phone";
import {
  DEFAULT_WHATSAPP_WIDGET_CONFIG,
  WIDGET_SURFACE_KEYS,
  WIDGET_TEXT_FIELD_KEYS,
  type WidgetTextFieldKey,
} from "../../../../../cod-shared/whatsapp-widget/config";
import type { WhatsAppWidgetCapabilities, WhatsAppWidgetConfig, WhatsAppWidgetDraft, SaveBlocker } from "./types";

export { DEFAULT_WHATSAPP_WIDGET_CONFIG };

const texts = <T>(map: (key: WidgetTextFieldKey) => T) => Object.fromEntries(WIDGET_TEXT_FIELD_KEYS.map((key) => [key, map(key)])) as Record<WidgetTextFieldKey, T>;

export function toDraft(config: WhatsAppWidgetConfig, avatarUrl: string | null = null): WhatsAppWidgetDraft {
  return {
    ...texts((key) => config[key] ?? ""),
    enabled: config.enabled,
    phone: config.phone ?? "",
    avatar: config.avatarKey ? { key: config.avatarKey, url: avatarUrl ?? "" } : null,
    accent: config.accent,
    position: config.position,
    attention: config.attention,
    surfaces: { ...config.surfaces },
  };
}

function cleanText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function toPayload(draft: WhatsAppWidgetDraft): WhatsAppWidgetConfig {
  return {
    ...texts((key) => cleanText(draft[key])),
    enabled: draft.enabled,
    phone: (draft.phone ? normalizeAlgerianPhone(draft.phone) : null) ?? cleanText(draft.phone),
    avatarKey: draft.avatar?.key ?? null,
    accent: draft.accent,
    position: draft.position,
    attention: draft.attention,
    surfaces: { ...draft.surfaces },
  };
}

export function isDirty(draft: WhatsAppWidgetDraft, saved: WhatsAppWidgetConfig): boolean {
  const payload = toPayload(draft);
  return (
    payload.enabled !== saved.enabled ||
    payload.phone !== saved.phone ||
    payload.avatarKey !== saved.avatarKey ||
    payload.accent !== saved.accent ||
    payload.position !== saved.position ||
    payload.attention !== saved.attention ||
    WIDGET_TEXT_FIELD_KEYS.some((key) => payload[key] !== saved[key]) ||
    WIDGET_SURFACE_KEYS.some((key) => payload.surfaces[key] !== saved.surfaces[key])
  );
}

export function getPhonePreview(rawPhone: string): { e164: string | null; isValid: boolean } {
  if (!rawPhone.trim()) return { e164: null, isValid: false };
  const normalized = normalizeAlgerianPhone(rawPhone);
  return { e164: normalized, isValid: normalized !== null };
}

/** The message each text's over-long refusal shows, by its field. */
const TOO_LONG: Record<WidgetTextFieldKey, string> = {
  agentName: "agent_name_too_long",
  caption: "caption_too_long",
  welcomeMessage: "welcome_message_too_long",
  launcherLabel: "launcher_label_too_long",
  ctaLabel: "cta_label_too_long",
  prefillGeneral: "prefill_general_too_long",
  prefillProduct: "prefill_product_too_long",
  thankYouButtonLabel: "thank_you_button_label_too_long",
  prefillThankYou: "prefill_thank_you_too_long",
};

/** What stops a save: a switched-on button without a usable number, a number that cannot be dialled, a text past its cap. */
export function validateDraft(draft: WhatsAppWidgetDraft, caps: WhatsAppWidgetCapabilities): SaveBlocker[] {
  const blockers: SaveBlocker[] = [];
  const phone = draft.phone.trim();
  if (draft.enabled && !phone) blockers.push({ field: "phone", message: "phone_required" });
  else if (phone && !normalizeAlgerianPhone(phone)) blockers.push({ field: "phone", message: "phone_invalid" });
  for (const key of WIDGET_TEXT_FIELD_KEYS) {
    if (draft[key].length > caps.textFields[key].max) blockers.push({ field: key, message: TOO_LONG[key] });
  }
  return blockers;
}
