import type { MessageLanguage } from "./language";
import { storeTime } from "./time";

const calls = (count: number) => (count === 1 ? "1 call" : `${count} calls`);

export const en: MessageLanguage = {
  locale: "en",
  numbers: "en",
  currency: "DZD",
  headline: {
    "order.created": (e) => `🛒 New order #${e.data.order.number}`,
    "order.updated": (e) => `✏️ Order #${e.data.order.number} was edited`,
    "order.confirmed": (e) => `✅ Order #${e.data.order.number} confirmed`,
    "order.unreachable": (e) =>
      e.data.order.unansweredCalls > 0
        ? `📵 No answer · Call ${e.data.order.unansweredCalls} — order #${e.data.order.number}`
        : e.data.previousStatus === "unreachable"
          ? `📵 Still no answer from the customer of order #${e.data.order.number}`
          : `📵 The customer of order #${e.data.order.number} could not be reached`,
    "order.preparing": (e) => `📦 Order #${e.data.order.number} is being prepared`,
    "order.ready": (e) => `📦 Order #${e.data.order.number} is ready to ship`,
    "order.cancelled": (e) =>
      e.data.previousStatus === "unreachable" && e.data.order.unansweredCalls > 0
        ? `❌ Order #${e.data.order.number} cancelled after ${calls(e.data.order.unansweredCalls)} without an answer`
        : `❌ Order #${e.data.order.number} cancelled`,
    "order.line_returned": (e) => `↩️ Items of order #${e.data.order.number} were refused at the door`,
    "order.deleted": (e) => `🗑️ Order #${e.data.order.number} deleted`,
    "order.assigned": (e) =>
      e.data.way === "take_back" && e.data.previousAssignee
        ? `⏱️ Order #${e.data.order.number} moved from ${e.data.previousAssignee.name} to ${e.data.assignee.name}: not handled in time`
        : `👤 Order #${e.data.order.number} is with ${e.data.assignee.name}`,
    "order.unassigned": (e) => `👤 Order #${e.data.order.number} is with nobody now`,
    "order.callback_scheduled": (e) =>
      e.data.previousAt
        ? `⏰ Call back for order #${e.data.order.number} moved to ${storeTime("en", e.data.at)}`
        : `⏰ Call back the customer of order #${e.data.order.number}: ${storeTime("en", e.data.at)}`,
    "order.callback_cleared": (e) => `🔕 No call back set any more for order #${e.data.order.number}`,
    "order.callback_due": (e) => `⏰ Time to call back the customer of order #${e.data.order.number}`,
    "shipment.handed_off": (e) => `🚚 Order #${e.data.order.number} handed to delivery`,
    "shipment.out_for_delivery": (e) => `🛵 Order #${e.data.order.number} is out for delivery`,
    "shipment.delivery_failed": (e) => `⚠️ Delivery attempt ${e.data.attempt} failed for order #${e.data.order.number}`,
    "shipment.delivered": (e) => `🎉 Order #${e.data.order.number} delivered`,
    "shipment.return_started": (e) => `↩️ Order #${e.data.order.number} is on its way back`,
    "shipment.returned": (e) => `📥 Order #${e.data.order.number} is back at the store`,
    "shipment.cancelled": (e) => `❌ The shipment of order #${e.data.order.number} was cancelled`,
    "shipment.voided": (e) => `⏪ The handoff of order #${e.data.order.number} was undone`,
    "review.submitted": (e) => `⭐ New review, ${e.data.review.rating}/5 — order #${e.data.order.number}`,
  },
  words: {
    total: "Total",
    toCollect: "To collect",
    carrier: "Carrier",
    driver: "Driver",
    tracking: "Tracking",
    reason: "Reason",
    by: "By",
    changed: "Changed",
    refused: "Refused",
    home: "home delivery",
    stopDesk: "stop desk",
    assignee: "With",
    callbackWas: "It was set for",
    voiceNote: "voice note",
    reviewPublished: "Published on your store",
    reviewPending: "Waiting for your approval",
  },
  fields: {
    customerName: "customer name",
    customerPhone: "phone",
    customerEmail: "email",
    destination: "address",
    notes: "notes",
  },
  connected: "✅ Connected. This chat will now receive your store's notifications.",
  test: "🔔 Test message: your store can reach this chat.",
  pairingRefused: "This link can no longer connect a chat. Open a new one from your store's Telegram App page.",
};
