import { useState } from "react";
import { Search } from "lucide-react";
import { Input, Textarea } from "@/components/ui";
import { useT } from "@/i18n/react";
import { ImageUploader } from "@/features/uploads/components/ImageUploader";
import type { MediaImage } from "@/features/uploads/api";
import type { StoreConfig, UpdateStoreData } from "@/features/settings/types";
import { FieldRow, SettingsSection } from "@/features/settings/components/SettingsSection";

/** How the store shows in search results and when its link is shared; its own pages may say more of themselves. */
export function SeoSettings({
  storeConfig,
  onSave,
}: {
  storeConfig: StoreConfig;
  onSave: (payload: Pick<UpdateStoreData, "metaTitle" | "metaDescription" | "ogImageKey">) => Promise<void>;
}) {
  const t = useT("settings");
  const [metaTitle, setMetaTitle] = useState(storeConfig.metaTitle ?? "");
  const [metaDesc, setMetaDesc] = useState(storeConfig.metaDescription ?? "");
  const [shareImage, setShareImage] = useState<MediaImage | null>(storeConfig.ogImage);

  return (
    <SettingsSection
      icon={Search}
      title={t("store.seo_title")}
      subtitle={t("store.seo_subtitle")}
      onSave={async () => {
        await onSave({
          metaTitle: metaTitle.trim() || null,
          metaDescription: metaDesc.trim() || null,
          ogImageKey: shareImage?.key ?? null,
        });
      }}
    >
      <FieldRow label={t("store.meta_title_label")}>
        <Input
          value={metaTitle}
          onChange={(event) => setMetaTitle(event.currentTarget.value)}
          placeholder={t("store.meta_title_placeholder")}
          maxLength={200}
        />
      </FieldRow>
      <FieldRow label={t("store.meta_desc_label")}>
        <Textarea
          value={metaDesc}
          onChange={(event) => setMetaDesc(event.currentTarget.value)}
          placeholder={t("store.meta_desc_placeholder")}
          maxLength={500}
          rows={3}
        />
      </FieldRow>
      <FieldRow label={t("store.share_image_label")} help={t("store.share_image_hint")}>
        <ImageUploader value={shareImage} onChange={setShareImage} alt={t("store.share_image_label")} shape="share" />
      </FieldRow>
    </SettingsSection>
  );
}
