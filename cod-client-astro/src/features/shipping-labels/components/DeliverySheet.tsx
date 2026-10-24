import { LABEL_WORDS, formatLabelAmount, formatLabelPhone, labelCurrency, placeName } from "../../../../../cod-shared/shipping-label/label";
import type { DeliverySheet as Sheet } from "@/features/shipping-labels/types";

const today = () => new Date().toLocaleDateString("fr-DZ", { day: "2-digit", month: "2-digit", year: "numeric" });

/**
 * A driver's delivery sheet on A4: every parcel still out with them, what
 * each one is to collect, and the total — with a column the driver fills in
 * by hand as the cash comes in, and signatures for the hand-over.
 */
export function DeliverySheet({ sheet }: { sheet: Sheet }) {
  const { config, sender, currency, driver, parcels, total } = sheet;
  const words = LABEL_WORDS[config.language];
  const money = (amount: number) => formatLabelAmount(amount, labelCurrency(currency, config.language));

  return (
    <article dir={config.language === "ar" ? "rtl" : "ltr"} lang={config.language} className="delivery-sheet bg-white text-[9.5pt] leading-snug text-black">
      <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-3">
        <div className="flex items-center gap-3">
          {config.showLogo && sender.logoUrl && <img src={sender.logoUrl} alt="" className="h-12 w-auto max-w-32 object-contain grayscale" />}
          <div>
            <p className="text-[13pt] font-bold">
              <bdi>{sender.name}</bdi>
            </p>
            {sender.phone && (
              <p>
                {words.phone} <bdi dir="ltr">{formatLabelPhone(sender.phone)}</bdi>
              </p>
            )}
          </div>
        </div>
        <div className="text-end">
          <h1 className="text-[16pt] font-black">{words.sheetTitle}</h1>
          <p>
            {words.date} <bdi dir="ltr">{today()}</bdi>
          </p>
        </div>
      </header>

      <section className="flex flex-wrap justify-between gap-4 py-3">
        <p className="text-[11pt]">
          <span className="font-bold">{words.driver} : </span>
          <bdi>{driver.name}</bdi> · <bdi dir="ltr">{formatLabelPhone(driver.phone)}</bdi>
        </p>
        <p className="text-[11pt]">
          <span className="font-bold">{words.parcels} : </span>
          <span className="tabular-nums">{total.parcels}</span>
        </p>
      </section>

      <table className="w-full border-collapse text-[9pt] [&_td]:px-1.5 [&_th]:px-1.5">
        <thead>
          <tr className="border-y-2 border-black text-start">
            <th className="w-[6mm] py-1.5 text-start">#</th>
            <th className="py-1.5 text-start">{words.order}</th>
            <th className="py-1.5 text-start">{words.customer}</th>
            <th className="py-1.5 text-start">{words.address}</th>
            <th className="py-1.5 text-end">{words.amount}</th>
            <th className="w-[22mm] py-1.5 text-end">{words.collected}</th>
          </tr>
        </thead>
        <tbody>
          {parcels.map((parcel, index) => {
            const place = [placeName(parcel.recipient.commune, config.language), placeName(parcel.recipient.wilaya, config.language)].filter(Boolean).join(" · ");
            return (
              <tr key={parcel.shipmentId} className="break-inside-avoid border-b border-black/60 align-top">
                <td className="py-1.5 tabular-nums">{index + 1}</td>
                <td className="py-1.5 font-mono font-semibold">
                  <bdi dir="ltr">{parcel.orderNumber}</bdi>
                </td>
                <td className="py-1.5">
                  <bdi className="block font-semibold">{parcel.recipient.name}</bdi>
                  <bdi dir="ltr" className="tabular-nums">
                    {formatLabelPhone(parcel.recipient.phone)}
                  </bdi>
                </td>
                <td className="py-1.5">
                  {place && <span className="block font-semibold">{place}</span>}
                  <bdi>{parcel.recipient.address}</bdi>
                </td>
                <td className="py-1.5 text-end font-bold tabular-nums">
                  <bdi dir="ltr">{money(parcel.amount)}</bdi>
                </td>
                <td className="border-s border-black/60 py-1.5" />
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-black">
            <td colSpan={4} className="py-2 font-bold">
              {words.total}
            </td>
            <td className="py-2 text-end text-[11pt] font-black tabular-nums">
              <bdi dir="ltr">{money(total.amount)}</bdi>
            </td>
            <td className="border-s border-black/60" />
          </tr>
        </tfoot>
      </table>

      <footer className="mt-10 grid grid-cols-2 gap-10 break-inside-avoid">
        {[words.signDriver, words.signStore].map((label) => (
          <div key={label} className="border-t border-black pt-1.5 text-[9pt] font-semibold">
            {label}
          </div>
        ))}
      </footer>
    </article>
  );
}
