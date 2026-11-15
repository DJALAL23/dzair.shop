import type { MessageLanguage } from "./language";
import { storeTime } from "./time";

const plural = new Intl.PluralRules("ar");
const calls = (count: number) => {
  switch (plural.select(count)) {
    case "one":
      return "اتصال واحد";
    case "two":
      return "اتصالين";
    case "few":
      return `${count} اتصالات`;
    case "many":
      return `${count} اتصالًا`;
    default:
      return `${count} اتصال`;
  }
};

export const ar: MessageLanguage = {
  locale: "ar",
  numbers: "ar-DZ",
  currency: "د.ج",
  headline: {
    "order.created": (e) => `🛒 طلب جديد رقم ${e.data.order.number}`,
    "order.updated": (e) => `✏️ تم تعديل الطلب رقم ${e.data.order.number}`,
    "order.confirmed": (e) => `✅ تم تأكيد الطلب رقم ${e.data.order.number}`,
    "order.unreachable": (e) =>
      e.data.order.unansweredCalls > 0
        ? `📵 لم يرد · اتصال ${e.data.order.unansweredCalls} — الطلب رقم ${e.data.order.number}`
        : e.data.previousStatus === "unreachable"
          ? `📵 لا رد بعد من زبون الطلب رقم ${e.data.order.number}`
          : `📵 تعذّر الوصول إلى زبون الطلب رقم ${e.data.order.number}`,
    "order.preparing": (e) => `📦 الطلب رقم ${e.data.order.number} قيد التحضير`,
    "order.ready": (e) => `📦 الطلب رقم ${e.data.order.number} جاهز للشحن`,
    "order.cancelled": (e) =>
      e.data.previousStatus === "unreachable" && e.data.order.unansweredCalls > 0
        ? `❌ تم إلغاء الطلب رقم ${e.data.order.number} بعد ${calls(e.data.order.unansweredCalls)} بلا رد`
        : `❌ تم إلغاء الطلب رقم ${e.data.order.number}`,
    "order.line_returned": (e) => `↩️ رُفضت منتجات من الطلب رقم ${e.data.order.number} عند التسليم`,
    "order.deleted": (e) => `🗑️ تم حذف الطلب رقم ${e.data.order.number}`,
    "order.assigned": (e) =>
      e.data.way === "take_back" && e.data.previousAssignee
        ? `⏱️ نُقل الطلب رقم ${e.data.order.number} من ${e.data.previousAssignee.name} إلى ${e.data.assignee.name}: لم يُعالَج في الوقت`
        : `👤 الطلب رقم ${e.data.order.number} أُسند إلى ${e.data.assignee.name}`,
    "order.unassigned": (e) => `👤 الطلب رقم ${e.data.order.number} لم يعد مسندًا إلى أحد`,
    "order.callback_scheduled": (e) =>
      e.data.previousAt
        ? `⏰ تغيّر موعد إعادة الاتصال بزبون الطلب رقم ${e.data.order.number}: ${storeTime("ar-DZ", e.data.at)}`
        : `⏰ إعادة الاتصال بزبون الطلب رقم ${e.data.order.number}: ${storeTime("ar-DZ", e.data.at)}`,
    "order.callback_cleared": (e) => `🔕 أُلغي موعد إعادة الاتصال بزبون الطلب رقم ${e.data.order.number}`,
    "order.callback_due": (e) => `⏰ حان وقت إعادة الاتصال بزبون الطلب رقم ${e.data.order.number}`,
    "shipment.handed_off": (e) => `🚚 تم تسليم الطلب رقم ${e.data.order.number} للتوصيل`,
    "shipment.out_for_delivery": (e) => `🛵 الطلب رقم ${e.data.order.number} في الطريق إلى الزبون`,
    "shipment.delivery_failed": (e) => `⚠️ فشلت محاولة التوصيل ${e.data.attempt} للطلب رقم ${e.data.order.number}`,
    "shipment.delivered": (e) => `🎉 تم توصيل الطلب رقم ${e.data.order.number}`,
    "shipment.return_started": (e) => `↩️ الطلب رقم ${e.data.order.number} في طريق العودة`,
    "shipment.returned": (e) => `📥 عاد الطلب رقم ${e.data.order.number} إلى المتجر`,
    "shipment.cancelled": (e) => `❌ تم إلغاء شحنة الطلب رقم ${e.data.order.number}`,
    "shipment.voided": (e) => `⏪ تم التراجع عن تسليم الطلب رقم ${e.data.order.number} للتوصيل`,
    "review.submitted": (e) => `⭐ تقييم جديد ${e.data.review.rating}/5 — الطلب رقم ${e.data.order.number}`,
  },
  words: {
    total: "المجموع",
    toCollect: "المبلغ المطلوب تحصيله",
    carrier: "شركة التوصيل",
    driver: "السائق",
    tracking: "رقم التتبع",
    reason: "السبب",
    by: "بواسطة",
    changed: "ما تغيّر",
    refused: "مرفوض",
    home: "توصيل إلى المنزل",
    stopDesk: "استلام من المكتب",
    assignee: "مسند إلى",
    callbackWas: "كان مقررًا في",
    voiceNote: "رسالة صوتية",
    reviewPublished: "منشور في متجرك",
    reviewPending: "في انتظار موافقتك",
  },
  fields: {
    customerName: "اسم الزبون",
    customerPhone: "الهاتف",
    customerEmail: "البريد الإلكتروني",
    destination: "العنوان",
    notes: "الملاحظات",
  },
  connected: "✅ تم الربط. ستصل إشعارات متجرك إلى هذه المحادثة من الآن.",
  test: "🔔 رسالة تجريبية: متجرك يستطيع الوصول إلى هذه المحادثة.",
  pairingRefused: "لم يعد هذا الرابط صالحًا لربط محادثة. افتح رابطًا جديدًا من صفحة تطبيق تيليغرام في متجرك.",
};
