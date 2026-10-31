import { useEffect, useState } from "react";
import { ArrowRight, Loader2, Star } from "lucide-react";
import { Alert, Field, LinkButton, Select, SwitchField } from "@/components/ui";
import { useT } from "@/i18n/react";
import { getReviewsApp, saveReviewsApp } from "@/features/apps/reviews/api";
import { reviewMediaRules, SHOPPER_REVIEW_MEDIA, shopperReviewMedia, type ShopperReviewMedia } from "@/features/apps/reviews/model";
import type { ReviewRules } from "@/features/apps/reviews/types";
import type { AppBodyProps } from "@/features/apps/types";
import { SettingsSection } from "@/features/settings/components/SettingsSection";
import { REVIEW_AUTO_PUBLISH, REVIEW_MAX_PHOTOS, REVIEW_VOICE_LENGTHS, type ReviewAutoPublish, type ReviewVoiceLength } from "../../../../../cod-shared/reviews/model";

/**
 * The Reviews App: the store's rules for its customers' reviews. The reviews
 * themselves are approved and rejected on the Reviews page.
 */
export default function ReviewsApp({ canManage, onSaved }: AppBodyProps) {
  const t = useT("apps");
  const common = useT("common");
  const [rules, setRules] = useState<ReviewRules | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    getReviewsApp().then(
      (loaded) => alive && setRules(loaded),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, []);

  if (failed) {
    return (
      <Alert role="alert" tone="critical">
        {common("load_failed")}
      </Alert>
    );
  }

  if (!rules) {
    return (
      <div role="status" aria-busy="true" className="flex min-h-40 items-center justify-center">
        <Loader2 size={22} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <ReviewRulesForm
        rules={rules}
        canManage={canManage}
        onSaved={(saved) => {
          setRules(saved);
          onSaved();
        }}
      />
      <section aria-labelledby="review-moderation" className="flex flex-col gap-3 rounded-xl bg-card px-5 py-4 shadow-card sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 id="review-moderation" className="text-sm font-semibold text-foreground">{t("reviews.moderation_title")}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("reviews.moderation_hint")}</p>
        </div>
        <LinkButton href="/reviews" variant="outline" className="shrink-0">
          {t("reviews.moderation_open")}
          <ArrowRight size={15} aria-hidden="true" className="rtl:rotate-180" />
        </LinkButton>
      </section>
    </>
  );
}

function ReviewRulesForm({ rules, canManage, onSaved }: { rules: ReviewRules; canManage: boolean; onSaved: (saved: ReviewRules) => void }) {
  const t = useT("apps");
  const [enabled, setEnabled] = useState(rules.enabled);
  const [media, setMedia] = useState<ShopperReviewMedia>(() => shopperReviewMedia(rules));
  const [photos, setPhotos] = useState(rules.maxPhotos > 0 ? rules.maxPhotos : 3);
  const [voiceSeconds, setVoiceSeconds] = useState<ReviewVoiceLength>(rules.voiceMaxSeconds ?? 60);
  const [autoPublish, setAutoPublish] = useState<ReviewAutoPublish>(rules.autoPublish);
  const takesPhotos = media === "photos" || media === "photos_voice";
  const takesVoice = media === "voice" || media === "photos_voice";

  return (
    <SettingsSection
      icon={Star}
      title={t("reviews.title")}
      subtitle={t("reviews.subtitle")}
      readOnly={!canManage}
      onSave={async () => {
        onSaved(await saveReviewsApp({ enabled, ...reviewMediaRules(media, photos, voiceSeconds), autoPublish }));
      }}
    >
      <SwitchField label={t("reviews.enabled_label")} help={t("reviews.enabled_hint")} checked={enabled} onChange={setEnabled} />
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
