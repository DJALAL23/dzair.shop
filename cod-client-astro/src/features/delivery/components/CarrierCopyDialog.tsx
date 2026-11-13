import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Truck } from "lucide-react";
import { Alert, Button, Dialog, Field, Input, Select, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { notify } from "@/lib/notify";
import { relativeTime } from "@/lib/relative-time";
import { wilayaLabel } from "@/lib/places";
import { useLocale, useT } from "@/i18n/react";
import { formatMoney } from "@/features/orders/model";
import { copyCarrierRates, listAllDeliveryCompanies, previewCarrierCopy, syncCompanyPlaces, type CarrierPricingDraft } from "@/features/delivery/api";
import type { DeliveryCompany, ShippingProfileWithRules } from "@/features/delivery/types";
import type { CarrierCopyPreview, WilayaPrices } from "../../../../../cod-shared/queries/profile-from-carrier";

const ROUNDINGS = [0, 10, 50, 100] as const;

type Problem = "not_read" | "no_rates" | "failed";

/** A wilaya whose prices or switches change with the copy. */
function changes(before: WilayaPrices | null, after: WilayaPrices | null): boolean {
  if (!before || !after) return before !== after;
  return (
    before.homeEnabled !== after.homeEnabled ||
    before.stopDeskEnabled !== after.stopDeskEnabled ||
    (after.homeEnabled && before.homePrice !== after.homePrice) ||
    (after.stopDeskEnabled && before.stopDeskPrice !== after.stopDeskPrice) ||
    before.communes !== after.communes
  );
}

/** What the copy changes, in counts a merchant reads at a glance. */
export function copySummary(preview: CarrierCopyPreview) {
  const served = preview.wilayas.filter((w) => w.after);
  return {
    wilayas: served.length,
    home: served.filter((w) => w.after!.homeEnabled).length,
    stopDesk: served.filter((w) => w.after!.stopDeskEnabled).length,
    communes: served.reduce((sum, w) => sum + w.after!.communes, 0),
    removed: preview.wilayas.filter((w) => w.before && !w.after).length,
    changed: preview.wilayas.filter((w) => changes(w.before, w.after)).sort((a, b) => Number(!a.after) - Number(!b.after)),
  };
}

function Price({ now, was, on, wasOn }: { now: number | null; was: number | null; on: boolean; wasOn: boolean }) {
  const t = useT("settings");
  const locale = useLocale();
  const show = (price: number | null, enabled: boolean) => (enabled && price !== null ? formatMoney(price, locale) : t("shipping.copy.off"));
  const different = show(now, on) !== show(was, wasOn);
  return (
    <span className="flex flex-col items-end">
      <span className={on ? "font-medium" : "text-muted-foreground"}>{show(now, on)}</span>
      {different && <span className="text-xs text-muted-foreground">{t("shipping.copy.was", { price: show(was, wasOn) })}</span>}
    </span>
  );
}

/**
 * Copy a delivery company's rates into a shipping profile: the company, the
 * amount added and the rounding, a preview of every wilaya that changes, then
 * the copy. The profile never follows the company afterwards.
 */
export function CarrierCopyDialog({ profile, onClose, onCopied }: { profile: ShippingProfileWithRules; onClose: () => void; onCopied: (profile: ShippingProfileWithRules) => void }) {
  const t = useT("settings");
  const locale = useLocale();
  const [companies, setCompanies] = useState<DeliveryCompany[] | null>(null);
  const [companyId, setCompanyId] = useState("");
  const [add, setAdd] = useState("0");
  const [roundTo, setRoundTo] = useState<(typeof ROUNDINGS)[number]>(0);
  const [preview, setPreview] = useState<CarrierCopyPreview | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState<"previewing" | "reading" | "copying" | null>(null);
  const [readAgain, setReadAgain] = useState(0);

  const amount = Number(add);
  const amountValid = add.trim() !== "" && Number.isInteger(amount) && amount >= 0 && amount <= 5000;
  const draft: CarrierPricingDraft | null = companyId && amountValid ? { companyId, add: amount, roundTo } : null;

  useEffect(() => {
    listAllDeliveryCompanies()
      .then((rows) => setCompanies(rows.filter((row) => row.active)))
      .catch(() => setCompanies([]));
  }, []);

  useEffect(() => {
    setPreview(null);
    setProblem(null);
    if (!draft) return;
    let current = true;
    setBusy("previewing");
    const timer = window.setTimeout(() => {
      previewCarrierCopy(profile.id, draft)
        .then((answer) => current && setPreview(answer))
        .catch((cause) => {
          if (!current) return;
          const code = cause instanceof ApiError ? cause.code : null;
          setProblem(code === "CARRIER_PLACES_NOT_READ" ? "not_read" : code === "CARRIER_RATES_MISSING" ? "no_rates" : "failed");
        })
        .finally(() => current && setBusy(null));
    }, 250);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [profile.id, companyId, add, roundTo, readAgain]);

  const summary = useMemo(() => (preview ? copySummary(preview) : null), [preview]);
  const company = companies?.find((row) => row.id === companyId) ?? null;
  const companyName = company ? (locale === "ar" ? company.nameAr : company.name) : "";

  async function read() {
    if (!companyId) return;
    setBusy("reading");
    try {
      await syncCompanyPlaces(companyId);
      setReadAgain((n) => n + 1);
    } catch {
      notify.error(t("shipping.copy.read_failed", { company: companyName }));
      setBusy(null);
    }
  }

  async function copy() {
    if (!draft) return;
    setBusy("copying");
    try {
      const updated = await copyCarrierRates(profile.id, draft);
      notify.success(t("shipping.copy.done", { company: companyName }));
      onCopied(updated);
    } catch {
      notify.error(t("shipping.copy.failed"));
      setBusy(null);
    }
  }

  return (
    <Dialog
      onClose={onClose}
      placement="end"
      icon={<Truck size={17} aria-hidden="true" />}
      title={t("shipping.copy.title")}
      description={t("shipping.copy.description", { profile: profile.name })}
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("shipping.copy.cancel")}
          </Button>
          <Button type="button" onClick={() => void copy()} disabled={!preview || busy !== null}>
            {busy === "copying" ? t("shipping.copy.copying") : t("shipping.copy.confirm")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label={t("shipping.copy.company")}>
          <Select value={companyId} onChange={(event) => setCompanyId(event.currentTarget.value)} aria-label={t("shipping.copy.company")}>
            <option value="">{companies === null ? t("shipping.copy.loading") : t("shipping.copy.pick_company")}</option>
            {(companies ?? []).map((row) => (
              <option key={row.id} value={row.id}>
                {locale === "ar" ? row.nameAr : row.name}
              </option>
            ))}
          </Select>
        </Field>
        {companies?.length === 0 && <p className="text-sm text-muted-foreground">{t("shipping.copy.no_companies")}</p>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t("shipping.copy.add")} hint={t("shipping.copy.add_hint")} error={amountValid ? undefined : t("shipping.copy.add_invalid")}>
            <Input type="number" inputMode="numeric" min={0} max={5000} step={1} value={add} onChange={(event) => setAdd(event.currentTarget.value)} />
          </Field>
          <Field label={t("shipping.copy.round")}>
            <Select value={String(roundTo)} onChange={(event) => setRoundTo(Number(event.currentTarget.value) as (typeof ROUNDINGS)[number])} aria-label={t("shipping.copy.round")}>
              {ROUNDINGS.map((step) => (
                <option key={step} value={String(step)}>
                  {step === 0 ? t("shipping.copy.round_none") : t("shipping.copy.round_up", { amount: formatMoney(step, locale) })}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {companyId && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
            <span className="text-muted-foreground">
              {preview?.company.placesSyncedAt
                ? t("shipping.copy.read_at", { company: companyName, when: relativeTime(preview.company.placesSyncedAt, locale) })
                : t("shipping.copy.read_never", { company: companyName })}
            </span>
            <Button type="button" variant="secondary" size="sm" onClick={() => void read()} disabled={busy !== null}>
              <RefreshCw size={14} aria-hidden="true" />
              {busy === "reading" ? t("shipping.copy.reading") : t("shipping.copy.read_again")}
            </Button>
          </div>
        )}

        {problem === "not_read" && <Alert tone="warning">{t("shipping.copy.not_read", { company: companyName })}</Alert>}
        {problem === "no_rates" && <Alert tone="warning">{t("shipping.copy.no_rates", { company: companyName })}</Alert>}
        {problem === "failed" && <Alert tone="critical">{t("shipping.copy.preview_failed")}</Alert>}
        {busy === "previewing" && !preview && <div role="status" aria-busy="true" className="h-24 shimmer rounded-lg" />}

        {summary && (
          <div className="space-y-3">
            <ul className="space-y-1 text-sm">
              <li>{t("shipping.copy.summary_wilayas", { count: summary.wilayas })}</li>
              <li className="text-muted-foreground">
                {t("shipping.copy.summary_home", { count: summary.home })} · {t("shipping.copy.summary_desk", { count: summary.stopDesk })}
              </li>
              {summary.communes > 0 && <li className="text-muted-foreground">{t("shipping.copy.summary_communes", { count: summary.communes })}</li>}
            </ul>
            {summary.removed > 0 && <Alert tone="warning">{t("shipping.copy.summary_removed", { count: summary.removed, company: companyName })}</Alert>}

            {summary.changed.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("shipping.copy.no_change")}</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("shipping.wilaya")}</TableHead>
                      <TableHead numeric>{t("shipping.home_delivery")}</TableHead>
                      <TableHead numeric>{t("shipping.stop_desk")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.changed.map(({ wilayaId, before, after }) => (
                      <TableRow key={wilayaId}>
                        <TableCell className="font-medium">
                          <span className="flex flex-col">
                            <span>{wilayaLabel(wilayaId, null, locale)}</span>
                            {after && after.communes > 0 && <span className="text-xs text-muted-foreground">{t("shipping.copy.own_communes", { count: after.communes })}</span>}
                            {!after && <span className="text-xs text-[var(--tone-warning-text)]">{t("shipping.copy.stops")}</span>}
                          </span>
                        </TableCell>
                        <TableCell numeric>
                          <Price now={after?.homePrice ?? null} on={after?.homeEnabled ?? false} was={before?.homePrice ?? null} wasOn={before?.homeEnabled ?? false} />
                        </TableCell>
                        <TableCell numeric>
                          <Price now={after?.stopDeskPrice ?? null} on={after?.stopDeskEnabled ?? false} was={before?.stopDeskPrice ?? null} wasOn={before?.stopDeskEnabled ?? false} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <p className="text-xs text-muted-foreground">{t("shipping.copy.note")}</p>
          </div>
        )}
      </div>
    </Dialog>
  );
}
