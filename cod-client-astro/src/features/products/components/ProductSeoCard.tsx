import { Card, Field, Input, Textarea } from "@/components/ui";
import { useT } from "@/i18n/react";
import { searchListing } from "@/features/products/model";
import { SEO_TEXT } from "../../../../../cod-shared/lib/seo";

interface ProductSeoCardProps {
  metaTitle: string;
  setMetaTitle: (value: string) => void;
  metaDescription: string;
  setMetaDescription: (value: string) => void;
  /** What a search result shows when a field is left empty. */
  name: string;
  description: string;
  handle: string;
  busy: boolean;
}

export function ProductSeoCard({ metaTitle, setMetaTitle, metaDescription, setMetaDescription, name, description, handle, busy }: ProductSeoCardProps) {
  const t = useT("products");
  const listing = searchListing({ metaTitle, metaDescription, name, description });
  const counter = (length: number, max: number) => (
    <span className={`block text-end text-xs tabular-nums ${length > max - 5 ? "text-[var(--tone-warning-text)]" : "text-muted-foreground"}`}>
      {length}/{max}
    </span>
  );
  return (
    <Card title={t("form.section_seo")} help={t("form.seo_help")}>
      <div className="grid gap-4">
        <Field label={t("form.meta_title_label")} help={t("form.meta_title_help")} hint={counter(metaTitle.length, SEO_TEXT.titleMax)}>
          <Input value={metaTitle} onChange={(event) => setMetaTitle(event.currentTarget.value)} placeholder={name || t("form.meta_title_placeholder")} maxLength={SEO_TEXT.titleMax} disabled={busy} />
        </Field>
        <Field label={t("form.meta_description_label")} help={t("form.meta_description_help")} hint={counter(metaDescription.length, SEO_TEXT.descriptionMax)}>
          <Textarea value={metaDescription} onChange={(event) => setMetaDescription(event.currentTarget.value)} placeholder={t("form.meta_description_placeholder")} maxLength={SEO_TEXT.descriptionMax} rows={3} disabled={busy} />
        </Field>
        <section aria-label={t("form.seo_preview")} className="rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">{t("form.seo_preview")}</p>
          <p className="mt-1 truncate text-sm text-muted-foreground" dir="ltr">/products/{handle}</p>
          <p className="truncate text-base font-medium text-[var(--tone-info-text)]">{listing.title || t("form.meta_title_placeholder")}</p>
          <p className="line-clamp-2 text-sm text-muted-foreground">{listing.description || t("form.seo_preview_empty")}</p>
        </section>
      </div>
    </Card>
  );
}
