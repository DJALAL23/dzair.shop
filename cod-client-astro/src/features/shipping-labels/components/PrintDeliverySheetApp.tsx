import { useEffect, useState } from "react";
import { ArrowLeft, Printer } from "lucide-react";
import { RequireAuth } from "@/features/auth/components/RequireAuth";
import { Alert, Button } from "@/components/ui";
import { useT } from "@/i18n/react";
import { getDeliverySheet } from "@/features/shipping-labels/api";
import type { DeliverySheet as Sheet } from "@/features/shipping-labels/types";
import { DeliverySheet } from "@/features/shipping-labels/components/DeliverySheet";
import { whenPrintable } from "@/features/shipping-labels/components/print";

/** A driver's delivery sheet, on A4, handed to the print dialog once it is ready. */
function Gated() {
  const t = useT("delivery");
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const driverId = new URLSearchParams(window.location.search).get("driver")?.trim();
    if (!driverId) {
      setError(t("labels.print.nothing"));
      return;
    }
    getDeliverySheet(driverId)
      .then(async (loaded) => {
        setSheet(loaded);
        if (loaded.parcels.length > 0) await whenPrintable(() => window.print());
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : t("labels.print.error")));
  }, []);

  return (
    <div className="print-sheet min-h-screen bg-muted p-6">
      <div className="print-toolbar mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={() => window.close()} className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft size={15} className="rtl:rotate-180" aria-hidden="true" />
          {t("labels.print.close")}
        </button>
        {sheet && sheet.parcels.length > 0 && (
          <Button type="button" onClick={() => window.print()}>
            <Printer size={15} aria-hidden="true" />
            {t("labels.print.print_sheet")}
          </Button>
        )}
      </div>
      {error && (
        <Alert role="alert" tone="critical" className="print-toolbar mx-auto max-w-[210mm]">
          {error}
        </Alert>
      )}
      {sheet && sheet.parcels.length === 0 && <p className="print-toolbar text-center text-sm font-medium text-muted-foreground">{t("labels.print.sheet_empty")}</p>}
      {!sheet && !error && (
        <p role="status" className="print-toolbar text-center text-sm font-medium text-muted-foreground">
          {t("labels.print.loading")}
        </p>
      )}
      {sheet && sheet.parcels.length > 0 && (
        <div className="sheet-page mx-auto w-[210mm] max-w-full bg-white p-[12mm] shadow-card">
          <DeliverySheet sheet={sheet} />
        </div>
      )}
    </div>
  );
}

export default function PrintDeliverySheetApp() {
  return (
    <RequireAuth>
      <Gated />
    </RequireAuth>
  );
}
