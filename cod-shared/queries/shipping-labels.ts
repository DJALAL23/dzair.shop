/**
 * Shipping labels and delivery sheets for the store's own drivers: their
 * settings, and everything a label prints, read in one trip to D1.
 *
 * A carrier prints its own label, so only driver shipments are labelled
 * here. Each read is one batch — the store, its legal profile (the sender's
 * address and phone), the parcels with their place names and driver, and
 * their order lines through a subquery — so a hundred labels cost the same
 * trip as one. Ids go in chunks under D1's 100 bound values.
 */

import { mediaUrl, type MediaDelivery } from "../media/delivery";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { AppDb } from "../db/client";
import { communes, drivers, orderProducts, orders, shipments, storeLegalProfile, stores, wilayas } from "../db/schema";
import { isDefaultShippingLabelConfig, parseShippingLabelConfig, serializeShippingLabelConfig, type ShippingLabelConfig } from "../shipping-label/config";
import type { LabelBatch, LabelParcel, LabelSender } from "../shipping-label/label";
import { chunkIds } from "./d1-limits";

type BatchStatement = Parameters<AppDb["batch"]>[0][number];
type StoreRow = typeof stores.$inferSelect;
type LegalRow = typeof storeLegalProfile.$inferSelect;

/** Saves the settings; the defaults are stored as NULL. */
export async function saveShippingLabelConfig(db: AppDb, storeId: string, config: ShippingLabelConfig): Promise<ShippingLabelConfig> {
  await db
    .update(stores)
    .set({ shippingLabelJson: isDefaultShippingLabelConfig(config) ? null : serializeShippingLabelConfig(config), updatedAt: new Date().toISOString() })
    .where(eq(stores.id, storeId))
    .run();
  return config;
}

/** The store as the sender its labels print. */
export function labelSender(store: Pick<StoreRow, "name" | "logoKey">, legal: Pick<LegalRow, "address" | "contactPhone"> | undefined, config: ShippingLabelConfig, delivery: MediaDelivery): LabelSender {
  return {
    name: store.name,
    logoUrl: store.logoKey ? mediaUrl(store.logoKey, delivery) : null,
    phone: config.senderPhone ?? legal?.contactPhone ?? null,
    address: legal?.address ?? null,
  };
}

/** The store, its legal profile, and its settings with the sender they print — one trip. */
export async function loadLabelSettings(db: AppDb, delivery: MediaDelivery) {
  const [storeRows, legalRows] = await db.batch([db.select().from(stores).limit(1), legalOfTheStore(db)]);
  const store = (storeRows as StoreRow[])[0];
  if (!store) return null;
  const legal = (legalRows as LegalRow[])[0];
  const config = parseShippingLabelConfig(store.shippingLabelJson);
  return { store, legal, config, sender: labelSender(store, legal, config, delivery) };
}

/** Single store per database, like getStore. */
function legalOfTheStore(db: AppDb) {
  return db.select().from(storeLegalProfile).where(eq(storeLegalProfile.storeId, sql`(select ${stores.id} from ${stores} limit 1)`));
}

/**
 * Each column aliased: a batch reads rows keyed by column name, and the joined
 * tables share names (id, name, name_ar, phone) that would overwrite each other.
 */
const col = <T>(table: string, column: string, alias: string) => sql<T>`${sql.identifier(table)}.${sql.identifier(column)}`.as(alias);
const parcelColumns = {
  shipmentId: col<string>("shipments", "id", "label_shipment_id"),
  kind: col<string>("shipments", "kind", "label_kind"),
  handedAt: col<string>("shipments", "created_at", "label_handed_at"),
  amount: col<number>("shipments", "cod_amount", "label_amount"),
  orderId: col<string>("orders", "id", "label_order_id"),
  orderNumber: col<string>("orders", "order_number", "label_order_number"),
  customerName: col<string>("orders", "customer_name", "label_customer_name"),
  phone: col<string>("orders", "phone", "label_phone"),
  address: col<string | null>("orders", "address", "label_address"),
  notes: col<string | null>("orders", "notes", "label_notes"),
  wilayaName: col<string | null>("wilayas", "name", "label_wilaya_name"),
  wilayaNameAr: col<string | null>("wilayas", "name_ar", "label_wilaya_name_ar"),
  communeName: col<string | null>("communes", "name", "label_commune_name"),
  communeNameAr: col<string | null>("communes", "name_ar", "label_commune_name_ar"),
  driverFirstName: col<string | null>("drivers", "first_name", "label_driver_first_name"),
  driverLastName: col<string | null>("drivers", "last_name", "label_driver_last_name"),
  driverPhone: col<string | null>("drivers", "phone", "label_driver_phone"),
};

type ParcelRow = { [K in keyof typeof parcelColumns]: (typeof parcelColumns)[K]["_"]["type"] | null };
type LineRow = { orderId: string; name: string; variant: string | null; quantity: number };

function parcelsWhere(db: AppDb, where: ReturnType<typeof and>) {
  return db
    .select(parcelColumns)
    .from(shipments)
    .innerJoin(orders, eq(orders.id, shipments.orderId))
    .leftJoin(wilayas, eq(wilayas.id, orders.wilayaId))
    .leftJoin(communes, eq(communes.id, orders.communeId))
    .leftJoin(drivers, eq(drivers.id, shipments.driverId))
    .where(where)
    .orderBy(asc(shipments.createdAt), sql`${sql.identifier("shipments")}.rowid`);
}

function linesOf(db: AppDb, orderIds: ReturnType<typeof db.select>) {
  return db
    .select({ orderId: orderProducts.orderId, name: orderProducts.productName, variant: orderProducts.variantLabel, quantity: orderProducts.quantity })
    .from(orderProducts)
    .where(inArray(orderProducts.orderId, orderIds as never))
    .orderBy(asc(orderProducts.createdAt), asc(orderProducts.id));
}

function toParcel(row: ParcelRow, lines: readonly LineRow[]): LabelParcel {
  const place = (name: string | null, nameAr: string | null) => (name ? { name, nameAr: nameAr ?? name } : null);
  return {
    shipmentId: row.shipmentId!,
    orderNumber: row.orderNumber!,
    handedAt: row.handedAt!,
    amount: Number(row.amount ?? 0),
    recipient: {
      name: row.customerName!,
      phone: row.phone!,
      wilaya: place(row.wilayaName, row.wilayaNameAr),
      commune: place(row.communeName, row.communeNameAr),
      address: row.address,
    },
    items: lines.filter((line) => line.orderId === row.orderId).map(({ name, variant, quantity }) => ({ name, variant, quantity })),
    notes: row.notes,
    driver: row.driverFirstName ? { name: `${row.driverFirstName} ${row.driverLastName ?? ""}`.trim(), phone: row.driverPhone } : null,
  };
}

function batchOf(store: StoreRow, legal: LegalRow | undefined, parcels: LabelParcel[], delivery: MediaDelivery): LabelBatch {
  const config = parseShippingLabelConfig(store.shippingLabelJson);
  return {
    config,
    sender: labelSender(store, legal, config, delivery),
    currency: { code: store.currency, symbol: store.currencySymbol },
    parcels,
  };
}

/**
 * The labels of these driver shipments, in the order asked. `missing` names
 * the ids that are no shipment, or a carrier's — which prints its own label.
 */
export async function loadDriverLabels(db: AppDb, shipmentIds: readonly string[], delivery: MediaDelivery): Promise<{ batch: LabelBatch; missing: string[] } | null> {
  const ids = [...new Set(shipmentIds)];
  const chunks = chunkIds(ids);
  const statements = [
    db.select().from(stores).limit(1),
    legalOfTheStore(db),
    ...chunks.map((chunk) => parcelsWhere(db, and(inArray(shipments.id, chunk), eq(shipments.kind, "driver")))),
    ...chunks.map((chunk) => linesOf(db, db.select({ id: shipments.orderId }).from(shipments).where(and(inArray(shipments.id, chunk), eq(shipments.kind, "driver"))) as never)),
  ];
  const [storeRows, legalRows, ...rest] = await db.batch(statements as unknown as [BatchStatement, ...BatchStatement[]]);
  const store = (storeRows as StoreRow[])[0];
  if (!store) return null;
  const parcelRows = (rest.slice(0, chunks.length) as ParcelRow[][]).flat();
  const lines = (rest.slice(chunks.length) as LineRow[][]).flat();
  const byId = new Map(parcelRows.map((row) => [row.shipmentId!, toParcel(row, lines)]));
  return {
    batch: batchOf(store, (legalRows as LegalRow[])[0], ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])), delivery),
    missing: ids.filter((id) => !byId.has(id)),
  };
}

/** A shipment still out with the driver: not delivered, returned or cancelled. */
const stillOut = and(isNull(shipments.deliveredAt), isNull(shipments.returnedAt), isNull(shipments.cancelledAt));

/**
 * A driver's delivery sheet: every parcel still out with them, in the order
 * they were given, and what they have to collect in all. Null when the
 * driver does not exist.
 */
export async function loadDeliverySheet(db: AppDb, driverId: string, delivery: MediaDelivery) {
  const open = and(eq(shipments.kind, "driver"), eq(shipments.driverId, driverId), stillOut);
  const [storeRows, legalRows, driverRows, parcelRows, lineRows] = await db.batch([
    db.select().from(stores).limit(1),
    legalOfTheStore(db),
    db.select({ id: drivers.id, firstName: drivers.firstName, lastName: drivers.lastName, phone: drivers.phone }).from(drivers).where(eq(drivers.id, driverId)),
    parcelsWhere(db, open),
    linesOf(db, db.select({ id: shipments.orderId }).from(shipments).where(open) as never),
  ] as unknown as [BatchStatement, ...BatchStatement[]]);
  const store = (storeRows as StoreRow[])[0];
  const driver = (driverRows as Array<{ id: string; firstName: string; lastName: string; phone: string }>)[0];
  if (!store || !driver) return null;
  const parcels = (parcelRows as ParcelRow[]).map((row) => toParcel(row, lineRows as LineRow[]));
  return {
    batch: batchOf(store, (legalRows as LegalRow[])[0], parcels, delivery),
    driver: { id: driver.id, name: `${driver.firstName} ${driver.lastName}`.trim(), phone: driver.phone },
    total: { parcels: parcels.length, amount: parcels.reduce((sum, parcel) => sum + parcel.amount, 0) },
  };
}
