import { useState } from "react";
import { Star } from "lucide-react";
import { useT } from "@/i18n/react";
import { SwitchField } from "@/components/ui";
import type { StoreConfig } from "@/features/settings/types";
import { SettingsSection } from "@/features/settings/components/SettingsSection";

export function ReviewsSettings({
  storeConfig,
  onSave,
}: {
  storeConfig: StoreConfig;
  onSave: (payload: { reviewsEnabled?: boolean }) => Promise<void>;
}) {
  const t = useT("settings");
  const [reviewsEnabled, setReviewsEnabled] = useState(storeConfig.reviewsEnabled ?? true);

  return (
    <SettingsSection
      icon={Star}
      title={t("store.reviews_title")}
      subtitle={t("store.reviews_subtitle")}
      onSave={async () => {
        await onSave({ reviewsEnabled });
      }}
    >
      <SwitchField
        label={t("store.reviews_enabled_label")}
        help={t("store.reviews_enabled_hint")}
        checked={reviewsEnabled}
        onChange={setReviewsEnabled}
      />
    </SettingsSection>
  );
}
