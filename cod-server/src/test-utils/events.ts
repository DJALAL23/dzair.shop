/**
 * A Business Event's order and shipment as a writer would snapshot them —
 * complete, valid against the catalogue, for tests that need event data.
 */
import { money } from "../../../cod-shared/events/money";
import type { OrderSnapshot, ShipmentSnapshot } from "../../../cod-shared/events/snapshots";

export const sampleOrder: OrderSnapshot = {
  id: "0b7e4c1a-2f7d-4a52-9d1e-1f3c5a9b7e21",
  number: "ORD-20261025-0001",
  status: "confirmed",
  type: "online",
  placedAt: "2026-10-25T09:14:03.120Z",
  customer: { id: "c-1", name: "Amina B.", phone: "0551234567", email: null },
  destination: {
    wilaya: { id: 16, name: "Alger", nameAr: "الجزائر" },
    commune: { id: "16001", name: "Alger Centre", nameAr: "الجزائر الوسطى" },
    city: null,
    address: "12 rue Didouche Mourad",
    deliveryType: "home",
    stationCode: null,
  },
  lines: [
    {
      id: "l-1",
      productId: "p-1",
      variantId: null,
      name: "Robe",
      variantLabel: "Rouge / M",
      sku: "RB-R-M",
      quantity: 2,
      unitPrice: money(2500),
      discount: money(200),
      total: money(4800),
      gift: false,
      offer: null,
      returnedQuantity: 0,
    },
    {
      id: "l-2",
      productId: null,
      variantId: null,
      name: "Foulard",
      variantLabel: null,
      sku: null,
      quantity: 1,
      unitPrice: money(0),
      discount: money(0),
      total: money(0),
      gift: true,
      offer: { id: null, name: "Un foulard offert" },
      returnedQuantity: 0,
    },
  ],
  subtotal: money(4800),
  deliveryFee: money(400),
  total: money(5200),
  coupon: { code: "AID10", discount: money(200) },
  freeDeliveryOffer: null,
  notes: null,
  customFields: [{ id: "f-1", label: "Taille", type: "select", value: "M" }],
};

export const sampleShipment: ShipmentSnapshot = {
  id: "s-1",
  kind: "carrier",
  carrier: { companyId: "dc-1", name: "Yalidine", provider: "yalidine" },
  driver: null,
  trackingNumber: "yal-ABC123",
  deliveryType: "home",
  stationCode: null,
  codAmount: money(5200),
  providerStatus: { value: "Sorti en livraison", label: null },
  handedOffAt: "2026-10-25T11:00:00.000Z",
  outForDeliveryAt: "2026-10-26T08:30:00.000Z",
  deliveredAt: null,
  returnStartedAt: null,
  returnedAt: null,
  cancelledAt: null,
  deliveryAttempts: 0,
};

