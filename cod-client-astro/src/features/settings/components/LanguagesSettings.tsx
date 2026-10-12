import { useState } from "react";
import { Languages, Star, Trash2 } from "lucide-react";
import { Badge, Button, Select, useConfirmDialog } from "@/components/ui";
import { useT } from "@/i18n/react";
import { STORE_LOCALE_INFO, type StoreLocale } from "../../../../../cod-shared/i18n/locales";
import { FieldRow, SettingsSection } from "@/features/settings/components/SettingsSection";
import {
  addLanguage,
  addableLocales,
  languageDraft,
  languagesPayload,
  makeDefault,
  removeLanguage,
  setPublished,
} from "@/features/settings/model";
import type { StoreConfig, UpdateStoreData } from "@/features/settings/types";

/**
 * The store's languages — Shopify's Settings → Languages. A language is
 * added unpublished, translated, then published; the default language is
 * always published. Nothing is saved until the merchant presses Save.
 */
export function LanguagesSettings({
  storeConfig,
  onSave,
}: {
  storeConfig: StoreConfig;
  onSave: (payload: UpdateStoreData) => Promise<void>;
}) {
  const t = useT("settings");
  const confirm = useConfirmDialog();
  const [draft, setDraft] = useState(() => languageDraft(storeConfig.languages, storeConfig.lang));
  const addable = addableLocales(draft);
  const [toAdd, setToAdd] = useState<StoreLocale | "">("");

  async function confirmRemove(locale: StoreLocale) {
    const ok = await confirm({
      title: t("languages.remove_title").replace("{language}", STORE_LOCALE_INFO[locale].nativeName),
      description: t("languages.remove_description"),
      confirmLabel: t("languages.remove"),
      tone: "danger",
    });
    if (ok) setDraft((current) => removeLanguage(current, locale));
  }

  async function confirmDefault(locale: StoreLocale) {
    const ok = await confirm({
      title: t("languages.default_title").replace("{language}", STORE_LOCALE_INFO[locale].nativeName),
      description: t("languages.default_description"),
      confirmLabel: t("languages.make_default"),
    });
    if (ok) setDraft((current) => makeDefault(current, locale));
  }

  return (
    <SettingsSection
      icon={Languages}
      title={t("store.languages_title")}
      subtitle={t("store.languages_subtitle")}
      onSave={() => onSave(languagesPayload(draft))}
    >
      <ul className="divide-y divide-border rounded-lg border border-border">
        {draft.languages.map(({ locale, published }) => {
          const isDefault = locale === draft.primary;
          const info = STORE_LOCALE_INFO[locale];
          return (
            <li key={locale} data-locale={locale} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span lang={locale} className="min-w-24 text-sm font-semibold text-foreground">
                {info.nativeName}
              </span>
              {isDefault ? (
                <Badge tone="brand" size="sm">{t("languages.default")}</Badge>
              ) : (
                <Badge tone={published ? "success" : "neutral"} size="sm">
                  {published ? t("languages.published") : t("languages.unpublished")}
                </Badge>
              )}
              <div className="ms-auto flex items-center gap-2">
                {!isDefault && (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => setDraft((current) => setPublished(current, locale, !published))}
                    >
                      {published ? t("languages.unpublish") : t("languages.publish")}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => void confirmDefault(locale)}>
                      <Star size={14} aria-hidden="true" />
                      {t("languages.make_default")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={t("languages.remove_title").replace("{language}", info.nativeName)}
                      onClick={() => void confirmRemove(locale)}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </Button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {addable.length > 0 && (
        <FieldRow label={t("languages.add_label")} hint={t("languages.add_hint")}>
          <div className="flex gap-2">
            <Select value={toAdd} onChange={(event) => setToAdd(event.currentTarget.value as StoreLocale | "")}>
              <option value="">{t("languages.add_placeholder")}</option>
              {addable.map((locale) => (
                <option key={locale} value={locale} lang={locale}>
                  {STORE_LOCALE_INFO[locale].nativeName}
                </option>
              ))}
            </Select>
            <Button
              type="button"
              variant="secondary"
              disabled={toAdd === ""}
              onClick={() => {
                if (toAdd === "") return;
                setDraft((current) => addLanguage(current, toAdd));
                setToAdd("");
              }}
            >
              {t("languages.add")}
            </Button>
          </div>
        </FieldRow>
      )}
    </SettingsSection>
  );
}
