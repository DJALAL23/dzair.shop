/**
 * The team's messages (Events context, Channel): what a Business Event says
 * to the store's team, in one of the store's languages, as plain text. Each
 * message is written from the event alone — the facts it carries as they were
 * — never from what the database says when it is sent. One language per file;
 * every Event Type has a headline in each, and the facts around it are laid
 * out the same way in all of them.
 */

import type { StoreLocale } from "../../i18n/locales";
import type { Money, OrderSnapshot, ShipmentSnapshot } from "../snapshots";
import type { BusinessEvent } from "../log";
import type { EventType } from "../catalogue";
import type { MessageLanguage } from "./language";
import { ar } from "./ar";
import { en } from "./en";
import { fr } from "./fr";

export type { MessageLanguage } from "./language";

export const MESSAGE_LANGUAGES: Readonly<Record<StoreLocale, MessageLanguage>> = { ar, fr, en };

/** The longest message Telegram delivers. */
export const MESSAGE_TEXT_MAX = 4096;
/** The most of one fact a message repeats: a name, an address, a reason. */
const FACT_MAX = 200;
/** The order lines a new order's message lists; the rest are counted. */
const LINES_SHOWN = 10;

/** At most `max` UTF-16 units, never cutting a character in two; what is cut ends with an ellipsis. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = "";
  for (const character of text) {
    if (out.length + character.length > max - 1) break;
    out += character;
  }
  return `${out}…`;
}

const fact = (text: string) => clip(text.replace(/\s+/g, " ").trim(), FACT_MAX);

function money(language: MessageLanguage, value: Money): string {
  return `${new Intl.NumberFormat(language.numbers, { maximumFractionDigits: 2 }).format(Number(value.amount))} ${language.currency}`;
}

function customer(order: OrderSnapshot): string {
  return `👤 ${fact(order.customer.name)} · ${fact(order.customer.phone)}`;
}

function destination(language: MessageLanguage, order: OrderSnapshot): string | null {
  const { wilaya, commune, deliveryType } = order.destination;
  const places = [wilaya, commune].flatMap((place) => (place ? [fact(language.locale === "ar" ? place.nameAr || place.name : place.name)] : []));
  if (places.length === 0) return null;
  return `📍 ${places.join(" — ")} (${deliveryType === "stop_desk" ? language.words.stopDesk : language.words.home})`;
}

function lines(order: OrderSnapshot): string[] {
  const shown = order.lines.slice(0, LINES_SHOWN).map((line) => `• ${line.quantity} × ${fact(line.name)}${line.variantLabel ? ` (${fact(line.variantLabel)})` : ""}`);
  const rest = order.lines.length - shown.length;
  return rest > 0 ? [...shown, `• … (+${rest})`] : shown;
}

function delivery(language: MessageLanguage, shipment: ShipmentSnapshot): string[] {
  const out: string[] = [];
  if (shipment.carrier) out.push(`🚚 ${language.words.carrier}: ${fact(shipment.carrier.name)}`);
  if (shipment.driver) out.push(`🚚 ${language.words.driver}: ${fact(shipment.driver.name)}`);
  if (shipment.trackingNumber) out.push(`${language.words.tracking}: ${fact(shipment.trackingNumber)}`);
  return out;
}

function facts(language: MessageLanguage, event: BusinessEvent): string[] {
  const { words } = language;
  const order = event.data.order;
  const total = `💰 ${words.total}: ${money(language, order.total)}`;
  switch (event.type) {
    case "order.created":
      return [customer(order), destination(language, order), ...lines(order), total].filter((line): line is string => line !== null);
    case "order.updated":
      return [customer(order), destination(language, order), `${words.changed}: ${event.data.changedFields.map((field) => language.fields[field]).join(", ")}`].filter(
        (line): line is string => line !== null,
      );
    case "order.line_returned": {
      const line = order.lines.find((candidate) => candidate.id === event.data.lineId);
      return [customer(order), ...(line ? [`• ${words.refused}: ${line.returnedQuantity} × ${fact(line.name)}`] : [])];
    }
    case "order.confirmed":
    case "order.unreachable":
    case "order.preparing":
    case "order.ready":
    case "order.cancelled":
    case "order.deleted":
      return [customer(order), total];
    case "shipment.handed_off":
    case "shipment.voided":
    case "shipment.out_for_delivery":
    case "shipment.delivery_failed":
    case "shipment.delivered":
    case "shipment.return_started":
    case "shipment.returned":
    case "shipment.cancelled": {
      const { shipment } = event.data;
      const reason = "reason" in event.data && event.data.reason ? [`${words.reason}: ${fact(event.data.reason)}`] : [];
      const amount = event.type === "shipment.delivered" ? total : `💰 ${words.toCollect}: ${money(language, shipment.codAmount)}`;
      return [customer(order), destination(language, order), ...delivery(language, shipment), ...reason, amount].filter((line): line is string => line !== null);
    }
    default:
      throw new Error(`No message for ${(event as { type: string }).type satisfies string}`);
  }
}

function headline<T extends EventType>(language: MessageLanguage, event: Extract<BusinessEvent, { type: T }>): string {
  return (language.headline[event.type as T] as (e: typeof event) => string)(event);
}

/** What `event` tells the team, in `locale`: plain text, at most `MESSAGE_TEXT_MAX` long. */
export function renderTeamMessage(event: BusinessEvent, locale: StoreLocale): string {
  const language = MESSAGE_LANGUAGES[locale];
  const by = event.actor.kind === "staff" || event.actor.kind === "agent" ? [`${language.words.by}: ${fact(event.actor.name)}`] : [];
  return clip([headline(language, event), ...facts(language, event), ...by].join("\n"), MESSAGE_TEXT_MAX);
}
