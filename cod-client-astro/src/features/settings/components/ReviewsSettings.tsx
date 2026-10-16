import { useState } from "react";
import { Star } from "lucide-react";
import { useT } from "@/i18n/react";
import { Field, Select, SwitchField } from "@/components/ui";
import type { StoreConfig, UpdateStoreData } from "@/features/settings/types";
import { SettingsSection } from "@/features/settings/components/SettingsSection";
import { reviewMediaSettings, SHOPPER_REVIEW_MEDIA, shopperReviewMedia, type ShopperReviewMedia } from "@/features/settings/model";
import { REVIEW_AUTO_PUBLISH, REVIEW_MAX_PHOTOS, REVIEW_VOICE_LENGTHS, type ReviewAutoPublish, type ReviewVoiceLength } from "../../../../../cod-shared/reviews/model";

/**
 * What the store takes in reviews: whether it takes them, what a shopper may
 * send with one (text, photos, a voice note), and what goes live without the
 * merchant checking it. Photos and a voice note never slow a product page: a
 * photo shows small until opened, a voice note loads only when played.
 */
export function ReviewsSettings({
  storeConfig,
  onSave,
}: {
  storeConfig: StoreConfig;
  onSave: (payload: UpdateStoreData) => Promise<void>;
}) {
  const t = useT("settings");
  const [enabled, setEnabled] = useState(storeConfig.reviewsEnabled ?? true);
  const [media, setMedia] = useState<ShopperReviewMedia>(() => shopperReviewMedia(storeConfig));
  const [photos, setPhotos] = useState(storeConfig.reviewMaxPhotos > 0 ? storeConfig.reviewMaxPhotos : 3);
  const [voiceSeconds, setVoiceSeconds] = useState<ReviewVoiceLength>(storeConfig.reviewVoiceMaxSeconds ?? 60);
  const [autoPublish, setAutoPublish] = useState<ReviewAutoPublish>(storeConfig.reviewAutoPublish ?? "off");
  const takesPhotos = media === "photos" || media === "photos_voice";
  const takesVoice = media === "voice" || media === "photos_voice";

  return (
    <SettingsSection
      icon={Star}
      title={t("store.reviews_title")}
      subtitle={t("store.reviews_subtitle")}
      onSave={async () => {
        await onSave({ reviewsEnabled: enabled, ...reviewMediaSettings(media, photos, voiceSeconds), reviewAutoPublish: autoPublish });
      }}
    >
      <SwitchField label={t("store.reviews_enabled_label")} help={t("store.reviews_enabled_hint")} checked={enabled} onChange={setEnabled} />
      {enabled && (
        <div className="space-y-4">
          <Field label={t("reviews.media_label")} hint={t(`reviews.media_hint_${media}`)}>
            <Select value={media} onChange={(event) => setMedia(event.currentTarget.value as ShopperReviewMedia)}>
              {SHOPPER_REVIEW_MEDIA.map((choice) => (
                <option key={choice} value={choice}>
                  {t(`reviews.media_${choice}`)}
                </option>
              ))}
            </Select>
          </Field>
          {(takesPhotos || takesVoice) && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {takesPhotos && (
                <Field label={t("reviews.photos_label")}>
                  <Select value={String(photos)} onChange={(event) => setPhotos(Number(event.currentTarget.value))}>
                    {Array.from({ length: REVIEW_MAX_PHOTOS }, (_, i) => i + 1).map((count) => (
                      <option key={count} value={count}>
                        {t("reviews.photos_count", { count })}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {takesVoice && (
                <Field label={t("reviews.voice_label")}>
                  <Select value={String(voiceSeconds)} onChange={(event) => setVoiceSeconds(Number(event.currentTarget.value) as ReviewVoiceLength)}>
                    {REVIEW_VOICE_LENGTHS.map((seconds) => (
                      <option key={seconds} value={seconds}>
                        {t("reviews.voice_seconds", { count: seconds })}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>
          )}
          <Field label={t("reviews.publish_label")} hint={t(`reviews.publish_hint_${autoPublish}`)}>
            <Select value={autoPublish} onChange={(event) => setAutoPublish(event.currentTarget.value as ReviewAutoPublish)}>
              {REVIEW_AUTO_PUBLISH.map((choice) => (
                <option key={choice} value={choice}>
                  {t(`reviews.publish_${choice}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}
    </SettingsSection>
  );
}
