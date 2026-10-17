import type { OrderStatus } from "../../../../cod-shared/orders/lifecycle";
import type { OrderStage } from "../../../../cod-shared/orders/stage";
import type { HandoffState, ShipmentEventSource, ShipmentKind } from "../../../../cod-shared/shipments/model";
import type { ShipmentAction } from "../../../../cod-shared/shipments/actions";
import type { InterpretationKind, Milestone } from "../../../../cod-shared/shipments/interpretation";

export type { OrderStatus, OrderStage, ShipmentAction, ShipmentKind, HandoffState, Milestone };
export type DeliveryType = "home" | "stop_desk";
export type OrderType = "online" | "offline";

export interface StatusHistoryItem {
  id: string;
  orderId?: string;
  status: OrderStatus;
  timestamp: string;
  by: string | null;
  byName: string | null;
}

export interface OrderProduct {
  id: string;
  orderId: string;
  /** Null once the product was removed: the line keeps what was sold. */
  productId: string | null;
  productName: string;
  variantId: string | null;
  variantLabel: string | null;
  sku?: string | null;
  quantity: number;
  pricePerUnit: number;
  lineTotal: number;
  status: "fulfilled" | "partially_returned" | "returned";
  returnedQuantity: number;
  createdAt: string;
  /** The offer that shaped the line: the quantity pricing that set its price, or the offer that gave it. */
  offerId: string | null;
  /** A reward, given by `offerId` at no charge. */
  reward: boolean;
}

export interface OrderBase {
  id: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  phone: string;
  wilayaId: number | null;
  wilaya: string | null;
  communeId: string | null;
  commune: string | null;
  city: string | null;
  address: string | null;
  price: number;
  deliveryFee: number;
  codAmount: number | null;
  /** The order's processing; its delivery is its shipment's — see `stage`. */
  status: OrderStatus;
  orderType: OrderType;
  /** What the customer asked for; the shipment may travel otherwise. */
  deliveryType: DeliveryType;
  stationCode: string | null;
  driverName: string | null;
  notes: string | null;
  landingPageId: string | null;
  /**
   * Captured at order time when the merchant enabled the email field. A
   * snapshot, like customerName — never re-read from the customer record.
   */
  customerEmail?: string | null;
  /** Answers to the merchant's custom questions, as stored with the order. */
  customFieldsJson?: string | null;
  /** When the finished order was archived: out of the working lists, still counted in sales. */
  archivedAt: string | null;
  /** Where the order stands overall: its processing, then its delivery. */
  stage: OrderStage;
  /** The delivery needs the merchant: an unconfirmed handoff, a parcel cancelled or flagged by the carrier. */
  needsAttention: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OrderListItem extends OrderBase {
  hasReview?: number;
  lastUpdatedBy?: string | null;
  shipmentId: string | null;
  shipmentKind: ShipmentKind | null;
  carrierName: string | null;
  trackingNumber: string | null;
}

export interface ShipmentEvent {
  id: string;
  source: ShipmentEventSource;
  vocabulary: string | null;
  providerStatus: string | null;
  providerStatusLabel: string | null;
  interpretation: InterpretationKind | null;
  milestone: Milestone | null;
  attention: boolean;
  anomaly: string | null;
  reason: string | null;
  occurredAt: string;
  recordedAt: string;
  actorId: string | null;
}

/** An order's delivery: a carrier company's parcel, or the store's own driver. */
export interface Shipment {
  id: string;
  orderId: string;
  kind: ShipmentKind;
  companyId: string | null;
  carrierName: string | null;
  driverId: string | null;
  handoffState: HandoffState;
  carrierParcelId: string | null;
  trackingNumber: string | null;
  deliveryType: DeliveryType;
  stationCode: string | null;
  codAmount: number;
  driverFee: number;
  weight: number | null;
  isFragile: boolean | null;
  providerStatus: string | null;
  providerStatusLabel: string | null;
  providerStatusKind: InterpretationKind | null;
  providerStatusAt: string | null;
  validatedAt: string | null;
  outForDeliveryAt: string | null;
  deliveredAt: string | null;
  returnStartedAt: string | null;
  returnedAt: string | null;
  cancelledAt: string | null;
  deliveryAttempts: number;
  attentionSince: string | null;
  lastSyncedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  /** What can be done to it now — the server's rules. */
  actions: ShipmentAction[];
  events?: ShipmentEvent[];
}

export interface OrderDetail extends OrderBase {
  products: OrderProduct[];
  statusHistory: StatusHistoryItem[];
  shipment: Shipment | null;
}

/** A note between the merchant and the carrier's courier. */
export interface ShipmentRemark {
  content: string;
  createdAt: string | null;
}

export interface OrderPage {
  orders: OrderListItem[];
  nextCursor: string | null;
}

export interface OrderStageCounts {
  stages: Array<{ stage: OrderStage; count: number }>;
  needsAttention: number;
  archived: number;
}

/** What can be done to clear an order away, as the server decides it. */
export interface OrderRemoval {
  id: string;
  orderNumber: string;
  shipment: "none" | "open" | "closed";
  /** Only an order never handed to delivery. */
  deletable: boolean;
  /** A finished order — cancelled, or its delivery ended — not archived yet. */
  archivable: boolean;
  archivedAt: string | null;
  lines: number;
  restockUnits: number;
  reviews: number;
}

/** How one order of a handoff ended. */
export type HandoffItem =
  | { orderId: string; orderNumber: string; outcome: "accepted"; shipment: Shipment; validationError?: string }
  | { orderId: string; orderNumber: string; outcome: "unknown"; shipment: Shipment; message: string }
  | { orderId: string; orderNumber: string | null; outcome: "refused"; error: { code: string; message: string } };

export interface BulkHandoff {
  results: HandoffItem[];
  summary: { accepted: number; unknown: number; refused: number };
}

export interface Driver {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  phone2: string | null;
  vehicleType: "motorcycle" | "car" | "van" | null;
  status: "available" | "busy" | "inactive";
}

export interface CarrierCapabilities {
  homeDelivery: boolean;
  stopDesk: boolean;
  separateValidation: boolean;
  bulkCreate: number;
  parcelFields: { weight: boolean; fragile: boolean; remarks: boolean };
  limits: { maxAmount: number | null; maxDescription: number | null };
  update: boolean;
  cancel: boolean;
  remarks: { add: boolean; list: boolean };
  history: boolean;
  historyBatch: number;
  findByReference: boolean;
  updates: "webhook" | "pull";
  label: boolean;
  askReturn: boolean;
  requestNewAttempt: boolean;
  confirmReturn: boolean;
  stopDeskList: boolean;
  geoNames: boolean;
  verifyConnection: boolean;
}

export interface DeliveryCompany {
  id: string;
  name: string;
  nameAr: string;
  code: string;
  active: boolean;
  isConnected: boolean;
  provider: string | null;
  supportsHomeDelivery: boolean;
  supportsStopDesk: boolean;
  autoValidate: boolean | null;
  capabilities: CarrierCapabilities | null;
}

export interface StopDesk {
  id: string;
  companyId: string;
  code: string;
  name: string;
  commune: string | null;
  wilayaId: number | null;
  address: string | null;
  active: boolean;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  phone2: string | null;
  wilayaId: number | null;
  communeId: string | null;
  wilaya: string;
  commune: string | null;
  address: string | null;
}

export interface ProductVariant {
  id: string;
  productId: string;
  variations: Record<string, string>;
  price: number;
  sku: string;
  inventory: number;
  active: boolean;
}

export interface Product {
  id: string;
  name: string;
  price: number;
  hasVariants: boolean;
  variants: ProductVariant[];
  inventory: number;
  totalInventory: number;
  trackInventory: boolean;
  shippingProfileId: string | null;
}

export interface ShippingRule {
  id: string;
  profileId: string;
  wilayaId: number;
  wilayaName: string;
  wilayaNameAr: string;
  homePrice: number;
  stopDeskPrice: number;
  homeEnabled: boolean;
  stopDeskEnabled: boolean;
}

export interface Wilaya {
  id: number;
  name: string;
  nameAr: string;
}

export interface Commune {
  id: string;
  wilayaId: number;
  name: string;
  nameAr: string;
  postalCode: string | null;
}

export const ABANDONED_STATUSES = [
  "pending",
  "abandoned",
  "contacted",
  "converted",
] as const;

export type AbandonedOrderStatus = (typeof ABANDONED_STATUSES)[number];

/** One line of an abandoned basket, as the storefront captured it. */
export interface AbandonedOrderItem {
  productId: string;
  productName: string;
  variantId?: string | null;
  variantLabel?: string | null;
  quantity: number;
  unitPrice: number;
}

export interface AbandonedOrder {
  id: string;
  sessionId: string;
  customerName: string;
  phone: string;
  wilayaId: number | null;
  communeId: string | null;
  wilayaName: string | null;
  communeName: string | null;
  /** The only product, or the first line of the basket. Always set when known. */
  productId: string | null;
  productName: string | null;
  variantId: string | null;
  variantLabel: string | null;
  /** Cart value at abandonment: the basket subtotal, or one unit's price. */
  price: number | null;
  /** The whole basket. Null for a single-product checkout. */
  items: AbandonedOrderItem[] | null;
  /** Distinct lines in the basket. Null for a single-product checkout. */
  itemCount: number | null;
  deliveryType: DeliveryType | null;
  status: AbandonedOrderStatus;
  convertedOrderId: string | null;
  convertedOrderNumber: string | null;
  recoveryAttempts: number;
  createdAt: string;
  updatedAt: string;
}

export interface AbandonedStats {
  totalAbandoned: number;
  totalConverted: number;
  conversionRate: number;
  estimatedLostRevenue: number;
}
