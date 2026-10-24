import { useEffect, useState } from "react";
import { ArrowLeft, Printer } from "lucide-react";
import { RequireAuth } from "@/features/auth/components/RequireAuth";
import { Alert, Button } from "@/components/ui";
import { useT } from "@/i18n/react";
import { getDeliverySheet, getDriverLabels } from "@/features/shipping-labels/api";
import { readLabelsQuery } from "@/features/shipping-labels/model";
import type { PrintableLabels } from "@/features/shipping-labels/types";
import { ShippingLabel } from "@/features/shipping-labels/components/ShippingLabel";
import { whenPrintable } from "@/features/shipping-labels/components/print";

/**
 * The labels page: each label on its own 100×150 mm page, opened in a new
 * tab and handed to the print dialog once its fonts and logo are in — to a
 * thermal printer, or saved as a PDF.
 */
function Gated() {
  const t = useT("delivery");
  const [labels, setLabels] = useState<PrintableLabels | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = readLabelsQuery(window.location.search);
    if (!query) {
      setError(t("labels.print.nothing"));
      return;
    }
    const load = "driverId" in query ? getDeliverySheet(query.driverId).then((sheet) => ({ ...sheet, missing: [] })) : getDriverLabels(query.shipmentIds);
    load
      .then(async (loaded) => {
        setLabels(loaded);
        if (loaded.parcels.length > 0) await whenPrintable(() => window.print());
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : t("labels.print.error")));
  }, []);

  return (
    <div className="print-sheet flex min-h-screen flex-col items-center gap-6 bg-muted p-6">
      <div className="print-toolbar flex w-full max-w-[100mm] flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={() => window.close()} className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft size={15} className="rtl:rotate-180" aria-hidden="true" />
          {t("labels.print.close")}
        </button>
        {labels && labels.parcels.length > 0 && (
          <Button type="button" onClick={() => window.print()}>
            <Printer size={15} aria-hidden="true" />
            {t("labels.print.print", { count: labels.parcels.length })}
          </Button>
        )}
      </div>
      {error && (
        <Alert role="alert" tone="critical" className="print-toolbar w-full max-w-[100mm]">
          {error}
        </Alert>
      )}
      {labels && labels.missing.length > 0 && (
        <Alert role="status" tone="warning" className="print-toolbar w-full max-w-[100mm]">
          {t("labels.print.missing", { count: labels.missing.length })}
        </Alert>
      )}
      {labels && labels.parcels.length === 0 && !error && (
        <p className="print-toolbar text-sm font-medium text-muted-foreground">{t("labels.print.nothing")}</p>
      )}
      {!labels && !error && (
        <p role="status" className="print-toolbar text-sm font-medium text-muted-foreground">
          {t("labels.print.loading")}
        </p>
      )}
      {labels?.parcels.map((parcel) => (
        <div key={parcel.shipmentId} className="label-page shadow-card">
          <ShippingLabel parcel={parcel} batch={labels} />
        </div>
      ))}
    </div>
  );
}

export default function PrintLabelsApp() {
  return (
    <RequireAuth>
      <Gated />
    </RequireAuth>
  );
}
