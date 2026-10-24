import type { ShippingLabelConfig } from "../../../../cod-shared/shipping-label/config";
import type { LabelBatch, LabelParcel, LabelSender } from "../../../../cod-shared/shipping-label/label";

export type { LabelBatch, LabelParcel, LabelSender, ShippingLabelConfig };

export interface LabelSettings {
  config: ShippingLabelConfig;
  sender: LabelSender;
  /** What prints as the sender's phone when the settings name none. */
  legalPhone: string | null;
  currency: LabelBatch["currency"];
}

export interface PrintableLabels extends LabelBatch {
  /** Asked for but not labelled here: unknown, or a carrier's — which prints its own. */
  missing: string[];
}

export interface DeliverySheet extends LabelBatch {
  driver: { id: string; name: string; phone: string };
  total: { parcels: number; amount: number };
}
