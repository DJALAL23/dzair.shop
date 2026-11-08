import { useEffect, useState } from "react";
import { ChevronDown, MapPinned, RefreshCw } from "lucide-react";
import { Alert, Button } from "@/components/ui";
import { useLocale, useT } from "@/i18n/react";
import { relativeTime } from "@/lib/relative-time";
import { cn } from "@/lib/utils";
import { getCompanyRates } from "@/features/delivery/api";
import { formatPriceRange } from "@/features/delivery/model";
import { listWilayas } from "@/features/geography/api";
import type { Wilaya } from "@/features/geography/types";
import type { CarrierPlacesSummary, WilayaRates } from "@/features/delivery/types";

/**
 * Where the company delivers, as its own list of places says: how many of
 * Algeria's communes, how many to the door and with a price, when the list
 * was read, what it charges by wilaya, and the places in it that name no
 * commune (never sent to). A parcel is addressed from this map alone, so a
 * company whose list was never read takes no order.
 */
export function CompanyPlacesCard({
  companyId,
  companyName,
  places,
  canManage,
  reading,
  onRead,
}: {
  companyId: string;
  companyName: string;
  places: CarrierPlacesSummary | null;
  canManage: boolean;
  reading: boolean;
  onRead: () => void;
}) {
  const t = useT("delivery_companies");
  const locale = useLocale();
  const [showUnmatched, setShowUnmatched] = useState(false);
  if (!places) return null;

  const read = places.syncedAt !== null;
  const share = places.total > 0 ? Math.round((places.communes / places.total) * 100) : 0;

  return (
    <div className="rounded-xl bg-card p-4 shadow-card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-card-foreground">
          <MapPinned size={14} className="text-primary/50" aria-hidden="true" />
          {t("places_title")}
        </h2>
        {canManage && (
          <Button type="button" variant={read ? "secondary" : "primary"} size="sm" onClick={onRead} disabled={reading}>
            <RefreshCw size={14} className={cn(reading && "animate-spin")} aria-hidden="true" />
            {read ? t("places_read_again") : t("places_read_now")}
          </Button>
        )}
      </div>

      {!read ? (
        <Alert tone="warning">{t("places_not_read", { company: companyName })}</Alert>
      ) : (
        <div className="space-y-3">
          <div>
            <p className="text-sm font-semibold text-foreground">{t("places_communes", { count: places.communes, total: places.total })}</p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <div className="h-full rounded-full bg-primary" style={{ width: `${share}%` }} />
            </div>
            <p className="mt-2 text-xs font-medium text-muted-foreground">
              {t("places_home", { count: places.home })} · {t("places_priced", { count: places.priced })} · {t("places_read_when", { when: relativeTime(places.syncedAt!, locale) })}
            </p>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">{t("places_explain", { company: companyName })}</p>
          <CompanyRates companyId={companyId} companyName={companyName} readAt={places.syncedAt!} priced={places.priced} />
          {places.unmatched.length > 0 && (
            <div className="rounded-lg border border-border">
              <button
                type="button"
                onClick={() => setShowUnmatched((open) => !open)}
                aria-expanded={showUnmatched}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-xs font-semibold text-foreground"
              >
                {t("places_unmatched", { count: places.unmatched.length, company: companyName })}
                <ChevronDown size={14} className={cn("shrink-0 transition-transform", showUnmatched && "rotate-180")} aria-hidden="true" />
              </button>
              {showUnmatched && (
                <ul className="max-h-60 divide-y divide-border overflow-y-auto border-t border-border text-xs">
                  {places.unmatched.map((place) => (
                    <li key={`${place.wilaya}|${place.commune}`} className="flex justify-between gap-3 px-3 py-1.5">
                      <span className="font-medium text-foreground">{place.commune}</span>
                      <span className="text-muted-foreground">{place.wilaya}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * What the company charges the store, by our wilaya: loaded when opened, and
 * again after each read of the map. A range is the lowest and highest price
 * among the wilaya's communes.
 */
function CompanyRates({ companyId, companyName, readAt, priced }: { companyId: string; companyName: string; readAt: string; priced: number }) {
  const t = useT("delivery_companies");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [rates, setRates] = useState<{ readAt: string; rows: WilayaRates[]; wilayas: Map<number, Wilaya> } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open || priced === 0 || rates?.readAt === readAt) return;
    let live = true;
    setFailed(false);
    Promise.all([getCompanyRates(companyId), listWilayas()])
      .then(([rows, wilayas]) => live && setRates({ readAt, rows, wilayas: new Map(wilayas.map((w) => [w.id, w])) }))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [open, companyId, readAt, priced, rates?.readAt]);

  const price = (range: WilayaRates["home"]) => (range ? formatPriceRange(range, locale) : <span className="text-muted-foreground">{t("rates_no_price")}</span>);
  const wilayaName = (id: number) => {
    const w = rates?.wilayas.get(id);
    return w ? `${String(id).padStart(2, "0")} ${locale === "ar" ? w.nameAr : w.name}` : String(id).padStart(2, "0");
  };

  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-xs font-semibold text-foreground"
      >
        {t("rates_title", { company: companyName })}
        <ChevronDown size={14} className={cn("shrink-0 transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open && (
        <div className="space-y-2 border-t border-border p-3">
          <p className="text-xs leading-relaxed text-muted-foreground">{t("rates_explain", { company: companyName })}</p>
          {priced === 0 ? (
            <Alert tone="info">{t("rates_none", { company: companyName })}</Alert>
          ) : failed ? (
            <Alert tone="critical">{t("rates_failed")}</Alert>
          ) : !rates || rates.readAt !== readAt ? (
            <div className="h-24 animate-pulse rounded-md bg-muted" aria-busy="true" />
          ) : (
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card text-muted-foreground">
                  <tr>
                    <th scope="col" className="py-1.5 pe-2 text-start font-medium">{t("rates_wilaya")}</th>
                    <th scope="col" className="px-2 py-1.5 text-end font-medium">{t("rates_home")}</th>
                    <th scope="col" className="px-2 py-1.5 text-end font-medium">{t("rates_stop_desk")}</th>
                    <th scope="col" className="ps-2 py-1.5 text-end font-medium">{t("rates_return")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rates.rows.map((row) => (
                    <tr key={row.wilayaId}>
                      <th scope="row" className="py-1.5 pe-2 text-start font-medium text-foreground">{wilayaName(row.wilayaId)}</th>
                      <td className="px-2 py-1.5 text-end tabular-nums">{price(row.home)}</td>
                      <td className="px-2 py-1.5 text-end tabular-nums">{price(row.stopDesk)}</td>
                      <td className="ps-2 py-1.5 text-end tabular-nums">{price(row.returnFee)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
