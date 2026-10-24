/**
 * /api/shipping-labels — labels and delivery sheets for the store's own drivers.
 */

import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppContext } from "@/types";
import { defineRoute } from "@/lib/route-builder";
import { SCOPES } from "../../../../cod-shared/rbac/scopes";
import { LABEL_LANGUAGES, LABEL_LIMITS, LABEL_SIZES, OPEN_PARCEL_POLICIES } from "../../../../cod-shared/shipping-label/config";
import * as h from "./handlers";

const jsonContent = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });

const ConfigSchema = z
  .object({
    size: z.enum(LABEL_SIZES).openapi({ description: "The physical label: 100×150 mm, the 4×6 inch roll of thermal printers" }),
    language: z.enum(LABEL_LANGUAGES).openapi({ description: "The language of the label's own words; the order's details print as written" }),
    showLogo: z.boolean(),
    senderPhone: z.string().nullable().openapi({ description: "Printed for the sender; null prints the legal profile's contact phone" }),
    showItems: z.boolean().openapi({ description: "What is in the parcel: quantity, name and variant of each line" }),
    showNotes: z.boolean().openapi({ description: "The order's notes, for the driver" }),
    openParcel: z.enum(OPEN_PARCEL_POLICIES).openapi({ description: "Whether the customer may open the parcel before paying; `unset` prints nothing" }),
    footer: z.string().max(LABEL_LIMITS.FOOTER_MAX).nullable(),
  })
  .openapi("ShippingLabelConfig");

const SenderSchema = z
  .object({ name: z.string(), logoUrl: z.string().nullable(), phone: z.string().nullable(), address: z.string().nullable() })
  .openapi("ShippingLabelSender", { description: "The store as its labels print it: its name and logo, and the phone and address of its legal profile" });

const CurrencySchema = z.object({ code: z.string(), symbol: z.string() });

const PlaceSchema = z.object({ name: z.string(), nameAr: z.string() }).nullable();

const ParcelSchema = z
  .object({
    shipmentId: z.string(),
    orderNumber: z.string(),
    handedAt: z.string().openapi({ description: "When the order was given to the driver" }),
    amount: z.number().openapi({ description: "The cash to collect, frozen on the shipment" }),
    recipient: z.object({ name: z.string(), phone: z.string(), wilaya: PlaceSchema, commune: PlaceSchema, address: z.string().nullable() }),
    items: z.array(z.object({ name: z.string(), variant: z.string().nullable(), quantity: z.number().int() })),
    notes: z.string().nullable(),
    driver: z.object({ name: z.string(), phone: z.string().nullable() }).nullable(),
  })
  .openapi("ShippingLabelParcel");

const SettingsResponse = z.object({
  success: z.boolean(),
  data: z.object({
    config: ConfigSchema,
    sender: SenderSchema,
    legalPhone: z.string().nullable().openapi({ description: "The legal profile's contact phone: what prints when the settings name no sender phone" }),
    currency: CurrencySchema,
  }),
});

const settingsRoute = defineRoute({
  method: "get",
  path: "/settings",
  auth: { scope: SCOPES.DELIVERY_READ },
  tags: ["Shipping Labels"],
  summary: "Get the shipping-label settings",
  description: "How the store's labels for its own drivers look, and the sender they print. A store that never set them gets the defaults.",
  operationId: "getShippingLabelSettings",
  responses: { 200: { description: "The settings", content: jsonContent(SettingsResponse) } },
  handler: h.getLabelSettings,
});

const putSettingsRoute = defineRoute({
  method: "put",
  path: "/settings",
  auth: { scope: SCOPES.DELIVERY_MANAGE },
  tags: ["Shipping Labels"],
  summary: "Replace the shipping-label settings",
  description: `Replaces the whole settings: a key you omit takes its default. Unknown keys are refused rather than ignored, and every problem is reported at once in \`context.issues\` (\`path\`, \`code\`). Saving the defaults stores nothing (the column goes back to NULL).`,
  operationId: "putShippingLabelSettings",
  body: z.record(z.string(), z.unknown()).openapi("ShippingLabelConfigInput", { description: "A ShippingLabelConfig with every key optional" }),
  responses: {
    200: { description: "The saved settings", content: jsonContent(SettingsResponse) },
    400: { description: "The settings were refused — see `context.issues`" },
  },
  handler: h.putLabelSettings,
});

const labelsRoute = defineRoute({
  method: "post",
  path: "/",
  auth: { scope: SCOPES.ORDERS_READ },
  tags: ["Shipping Labels"],
  summary: "The labels of driver shipments",
  description: `Everything the labels of up to 100 driver shipments print, read in one trip: the settings, the sender, and each parcel — the customer, the place, the cash to collect, the lines, the notes and the driver — in the order asked. A carrier prints its own label (\`GET /shipments/{id}/label\`), so a carrier shipment, like an unknown id, is listed in \`missing\`. A read: nothing is written.`,
  operationId: "getDriverShippingLabels",
  body: z.object({ shipmentIds: z.array(z.string().min(1)).min(1).max(100) }),
  responses: {
    200: {
      description: "The labels",
      content: jsonContent(
        z.object({
          success: z.boolean(),
          data: z.object({ config: ConfigSchema, sender: SenderSchema, currency: CurrencySchema, parcels: z.array(ParcelSchema), missing: z.array(z.string()) }),
        }),
      ),
    },
  },
  handler: h.getDriverLabels,
});

const deliverySheetRoute = defineRoute({
  method: "get",
  path: "/delivery-sheet/{driverId}",
  auth: { scope: SCOPES.ORDERS_READ },
  tags: ["Shipping Labels"],
  summary: "A driver's delivery sheet",
  description: "Every parcel still out with the driver — not delivered, returned or cancelled — in the order they were given, with the cash each has to collect and the total, read in one trip.",
  operationId: "getDriverDeliverySheet",
  params: z.object({ driverId: z.string().min(1) }),
  responses: {
    200: {
      description: "The delivery sheet",
      content: jsonContent(
        z.object({
          success: z.boolean(),
          data: z.object({
            config: ConfigSchema,
            sender: SenderSchema,
            currency: CurrencySchema,
            parcels: z.array(ParcelSchema),
            driver: z.object({ id: z.string(), name: z.string(), phone: z.string() }),
            total: z.object({ parcels: z.number().int(), amount: z.number() }),
          }),
        }),
      ),
    },
    404: { description: "Driver not found" },
  },
  handler: h.getDeliverySheet,
});

const router = new OpenAPIHono<AppContext>();
router.openapi(settingsRoute.route, settingsRoute.handler);
router.openapi(putSettingsRoute.route, putSettingsRoute.handler);
router.openapi(deliverySheetRoute.route, deliverySheetRoute.handler);
router.openapi(labelsRoute.route, labelsRoute.handler);

export default router;
