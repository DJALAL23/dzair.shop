import { useState } from "react";
import { ChevronLeft, ChevronRight, Mic, Trash2 } from "lucide-react";
import { useT } from "@/i18n/react";
import { Button, Dialog } from "@/components/ui";
import { formatDuration } from "@/features/reviews/model";
import type { ReviewMedia } from "@/features/reviews/types";

/**
 * A review's photos as small thumbnails; one opens at full size, where the
 * merchant can page through them and take one off the review.
 */
export function ReviewPhotos({
  photos,
  customerName,
  onRemove,
}: {
  photos: ReviewMedia[];
  customerName: string;
  /** Present when the merchant may take a photo off the review. */
  onRemove?: (photo: ReviewMedia) => Promise<boolean>;
}) {
  const t = useT("reviews");
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  if (photos.length === 0) return null;
  const current = open === null ? null : photos[Math.min(open, photos.length - 1)];

  return (
    <>
      <ul className="flex flex-wrap gap-2" aria-label={t("media.photos_label", { count: photos.length })}>
        {photos.map((photo, index) => (
          <li key={photo.id}>
            <button
              type="button"
              onClick={() => setOpen(index)}
              aria-label={t("media.open_photo", { index: index + 1, name: customerName })}
              className="block size-16 overflow-hidden rounded-lg bg-muted shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <img src={photo.thumbUrl ?? photo.url} alt="" loading="lazy" decoding="async" width={64} height={64} className="size-full object-cover" />
            </button>
          </li>
        ))}
      </ul>
      {current && open !== null && (
        <Dialog
          onClose={() => setOpen(null)}
          title={t("media.photo_title", { index: open + 1, total: photos.length, name: customerName })}
          className="max-w-3xl"
          footer={
            <div className="flex w-full items-center justify-between gap-2">
              {onRemove ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="text-destructive"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    const removed = await onRemove(current).finally(() => setBusy(false));
                    if (removed) setOpen(photos.length > 1 ? Math.max(0, open - 1) : null);
                  }}
                >
                  <Trash2 size={14} aria-hidden="true" />
                  {t("media.remove_photo")}
                </Button>
              ) : (
                <span />
              )}
              {photos.length > 1 && (
                <div className="flex gap-1.5">
                  <Button type="button" variant="secondary" className="size-9 min-h-9 px-0" onClick={() => setOpen((open - 1 + photos.length) % photos.length)} aria-label={t("media.previous")}>
                    <ChevronLeft size={16} className="rtl:rotate-180" />
                  </Button>
                  <Button type="button" variant="secondary" className="size-9 min-h-9 px-0" onClick={() => setOpen((open + 1) % photos.length)} aria-label={t("media.next")}>
                    <ChevronRight size={16} className="rtl:rotate-180" />
                  </Button>
                </div>
              )}
            </div>
          }
        >
          <img
            src={current.url}
            alt={t("media.photo_alt", { name: customerName })}
            width={current.width ?? undefined}
            height={current.height ?? undefined}
            className="mx-auto max-h-[65dvh] w-auto rounded-lg object-contain"
          />
        </Dialog>
      )}
    </>
  );
}

/**
 * A review's voice note: nothing is downloaded until the merchant plays it,
 * so a list of voice reviews costs no bandwidth.
 */
export function ReviewVoiceNote({
  voice,
  onRemove,
}: {
  voice: ReviewMedia;
  onRemove?: (voice: ReviewMedia) => Promise<boolean>;
}) {
  const t = useT("reviews");
  const [busy, setBusy] = useState(false);
  const duration = formatDuration(voice.durationMs);
  return (
    <div className="flex max-w-md items-center gap-2 rounded-lg bg-muted/60 p-1.5 ps-2.5">
      <Mic size={15} className="shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">{t("media.voice_label")}</span>
      <audio controls preload="none" src={voice.url} className="h-9 min-w-0 flex-1">
        <a href={voice.url}>{t("media.voice_download")}</a>
      </audio>
      {duration && <span className="shrink-0 text-xs tabular-nums text-muted-foreground" dir="ltr">{duration}</span>}
      {onRemove && (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onRemove(voice).finally(() => setBusy(false));
          }}
          aria-label={t("media.remove_voice")}
          title={t("media.remove_voice")}
          className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-destructive"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}
