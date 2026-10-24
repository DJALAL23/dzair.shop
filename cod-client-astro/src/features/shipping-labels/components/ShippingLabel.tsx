import { LABEL_WORDS, formatLabelAmount, formatLabelPhone, labelCurrency, moreItems, placeName } from "../../../../../cod-shared/shipping-label/label";
import type { LabelBatch, LabelParcel } from "@/features/shipping-labels/types";
import { labelItems } from "@/features/shipping-labels/model";
import { Barcode } from "@/features/shipping-labels/components/Barcode";

const date = (iso: string) => new Date(iso).toLocaleDateString("fr-DZ", { day: "2-digit", month: "2-digit", year: "numeric" });

/**
 * One 100×150 mm label for a parcel the store's own driver carries, in the
 * store's chosen language. Black on white, for a thermal head: the customer
 * and the cash to collect are the largest things on it, the order number
 * is a barcode, and nothing depends on colour.
 */
export function ShippingLabel({ parcel, batch }: { parcel: LabelParcel; batch: Pick<LabelBatch, "config" | "sender" | "currency"> }) {
  const { config, sender, currency } = batch;
  const words = LABEL_WORDS[config.language];
  const { shown, more } = labelItems(parcel);
  const place = [placeName(parcel.recipient.commune, config.language), placeName(parcel.recipient.wilaya, config.language)].filter(Boolean).join(" · ");
  const open = config.openParcel === "allowed" ? words.openAllowed : config.openParcel === "forbidden" ? words.openForbidden : null;

  return (
    <article
      data-shipping-label={parcel.shipmentId}
      dir={config.language === "ar" ? "rtl" : "ltr"}
      lang={config.language}
      className="shipping-label flex h-[150mm] w-[100mm] flex-col overflow-hidden bg-white p-[3mm] text-[9pt] leading-tight text-black"
    >
      <header className="flex items-center gap-[2.5mm] border-b-[0.5mm] border-black pb-[2mm]">
        {config.showLogo && sender.logoUrl && <img src={sender.logoUrl} alt="" className="h-[11mm] w-auto max-w-[24mm] object-contain grayscale" />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11pt] font-bold">
            <bdi>{sender.name}</bdi>
          </p>
          {sender.phone && (
            <p className="text-[9pt]">
              {words.phone} <bdi dir="ltr">{formatLabelPhone(sender.phone)}</bdi>
            </p>
          )}
        </div>
        <p className="shrink-0 rounded-[1mm] border-[0.4mm] border-black px-[1.5mm] py-[0.8mm] text-[8pt] font-bold uppercase">{words.homeDelivery}</p>
      </header>

      <section className="border-b-[0.5mm] border-black py-[2mm]">
        <p className="text-[8pt] font-semibold uppercase">{words.to}</p>
        <p className="mt-[0.5mm] text-[15pt] font-extrabold leading-snug">
          <bdi>{parcel.recipient.name}</bdi>
        </p>
        <p className="text-[15pt] font-extrabold tabular-nums">
          <bdi dir="ltr">{formatLabelPhone(parcel.recipient.phone)}</bdi>
        </p>
        {place && <p className="mt-[1mm] text-[11pt] font-bold">{place}</p>}
        {parcel.recipient.address && (
          <p className="mt-[0.5mm] line-clamp-3 text-[10pt]">
            <bdi>{parcel.recipient.address}</bdi>
          </p>
        )}
      </section>

      <section className="my-[2mm] flex items-center justify-between gap-[2mm] rounded-[1.5mm] border-[0.7mm] border-black px-[2.5mm] py-[1.5mm]">
        <p className="text-[9pt] font-bold uppercase">{words.amount}</p>
        <p className="text-[22pt] font-black tabular-nums" dir="ltr">
          {formatLabelAmount(parcel.amount, labelCurrency(currency, config.language))}
        </p>
      </section>

      <section className="min-h-0 flex-1 overflow-hidden">
        {config.showItems && shown.length > 0 && (
          <>
            <p className="text-[8pt] font-semibold uppercase">{words.items}</p>
            <ul className="mt-[0.5mm] space-y-[0.3mm]">
              {shown.map((item, index) => (
                <li key={index} className="truncate text-[9pt]">
                  <span className="font-bold tabular-nums">{item.quantity} ×</span> <bdi>{item.variant ? `${item.name} (${item.variant})` : item.name}</bdi>
                </li>
              ))}
              {more > 0 && <li className="text-[8.5pt] font-semibold">{moreItems(more, config.language)}</li>}
            </ul>
          </>
        )}
        {config.showNotes && parcel.notes && (
          <p className="mt-[1mm] line-clamp-2 text-[9pt]">
            <span className="font-bold">{words.notes} : </span>
            <bdi>{parcel.notes}</bdi>
          </p>
        )}
      </section>

      <section className="flex flex-col items-center border-t-[0.5mm] border-black pt-[2mm]">
        <Barcode text={parcel.orderNumber} maxWidthMm={88} heightMm={13} />
        <p className="mt-[0.8mm] font-mono text-[10pt] font-bold tracking-wide" dir="ltr">
          {parcel.orderNumber}
        </p>
        <p className="mt-[0.5mm] flex w-full justify-between gap-[2mm] text-[8pt]">
          <span>
            {words.date} <bdi dir="ltr">{date(parcel.handedAt)}</bdi>
          </span>
          {parcel.driver && (
            <span className="truncate">
              {words.driver} : <bdi>{parcel.driver.name}</bdi>
            </span>
          )}
        </p>
      </section>

      {(open || config.footer || sender.address) && (
        <footer className="mt-[1.5mm] border-t-[0.3mm] border-black pt-[1mm] text-[7.5pt]">
          {open && <p className="font-bold">{open}</p>}
          {sender.address && (
            <p className="truncate">
              {words.from} : <bdi>{sender.name}</bdi> — <bdi>{sender.address}</bdi>
            </p>
          )}
          {config.footer && (
            <p className="truncate">
              <bdi>{config.footer}</bdi>
            </p>
          )}
        </footer>
      )}
    </article>
  );
}
