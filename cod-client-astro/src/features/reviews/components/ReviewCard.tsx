import { BadgeCheck, CheckCircle, MoreHorizontal, Star, Store, Trash2, XCircle } from "lucide-react";
import { useLocale, useT } from "@/i18n/react";
import { Badge, Button, DropdownItem, DropdownMenu, Initial } from "@/components/ui";
import { formatReviewDate, photosOf, voiceOf } from "@/features/reviews/model";
import type { Review, ReviewMedia, ReviewStatus } from "@/features/reviews/types";
import { ReviewPhotos, ReviewVoiceNote } from "@/features/reviews/components/ReviewMediaView";

export function StarRating({ rating }: { rating: number }) {
  const t = useT("reviews");
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={t("rating_label", { count: rating })}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Star key={star} size={14} aria-hidden="true" className={star <= rating ? "fill-tone-warning-text text-tone-warning-text" : "text-muted-foreground/30"} />
      ))}
    </span>
  );
}

function StatusBadge({ status }: { status: ReviewStatus }) {
  const t = useT("reviews");
  const tone = status === "approved" ? "success" : status === "rejected" ? "critical" : "warning";
  return <Badge tone={tone}>{t(`status_${status}`)}</Badge>;
}

export interface ReviewActions {
  busy: boolean;
  onStatus: (status: ReviewStatus) => void;
  onDelete: () => void;
  onRemoveMedia: (media: ReviewMedia) => Promise<boolean>;
}

/**
 * One review as the merchant reads it: who, what and how it was rated, its
 * photos and voice note, whether it is a verified purchase or one the store
 * entered — and, for whoever may moderate, the decision at hand.
 */
export function ReviewCard({ review, actions }: { review: Review; actions: ReviewActions | null }) {
  const t = useT("reviews");
  const common = useT("common");
  const locale = useLocale();
  const photos = photosOf(review);
  const voice = voiceOf(review);

  return (
    <article className="flex gap-3 p-4" aria-label={t("card_label", { name: review.customerName })}>
      <Initial name={review.customerName} />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate text-sm font-semibold text-foreground" dir="auto">{review.customerName}</span>
              <StatusBadge status={review.status} />
              {review.verified && (
                <Badge tone="success">
                  <BadgeCheck size={12} aria-hidden="true" />
                  {t("badge_verified")}
                </Badge>
              )}
              {review.source === "merchant" && (
                <Badge tone="neutral">
                  <Store size={12} aria-hidden="true" />
                  {t("badge_store")}
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <StarRating rating={review.rating} />
              <span aria-hidden="true">·</span>
              <time dateTime={review.createdAt}>{formatReviewDate(review.createdAt, locale)}</time>
              {review.productName && (
                <>
                  <span aria-hidden="true">·</span>
                  <a href={`/products/${encodeURIComponent(review.productId)}`} className="truncate underline-offset-2 hover:underline">{review.productName}</a>
                </>
              )}
              {review.orderId && review.orderNumber && (
                <>
                  <span aria-hidden="true">·</span>
                  <a href={`/orders/${encodeURIComponent(review.orderId)}`} dir="ltr" className="underline-offset-2 hover:underline">{review.orderNumber}</a>
                </>
              )}
            </div>
          </div>
          {actions && (
            <div className="flex shrink-0 items-center gap-1.5">
              {review.status !== "approved" && (
                <Button type="button" size="sm" disabled={actions.busy} onClick={() => actions.onStatus("approved")}>
                  <CheckCircle size={14} aria-hidden="true" />
                  {t("action_approve")}
                </Button>
              )}
              <DropdownMenu trigger={<MoreHorizontal size={16} />} triggerLabel={`${common("table.actions")}: ${review.customerName}`}>
                {review.status !== "rejected" && (
                  <DropdownItem disabled={actions.busy} onClick={() => actions.onStatus("rejected")}>
                    <XCircle size={14} />
                    {t("action_reject")}
                  </DropdownItem>
                )}
                {review.status !== "pending" && (
                  <DropdownItem disabled={actions.busy} onClick={() => actions.onStatus("pending")}>
                    <Star size={14} />
                    {t("action_requeue")}
                  </DropdownItem>
                )}
                <DropdownItem disabled={actions.busy} onClick={actions.onDelete} danger>
                  <Trash2 size={14} />
                  {t("action_delete")}
                </DropdownItem>
              </DropdownMenu>
            </div>
          )}
        </div>
        {review.title && <p className="text-sm font-semibold text-foreground" dir="auto">{review.title}</p>}
        {review.body && <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90" dir="auto">{review.body}</p>}
        {voice && <ReviewVoiceNote voice={voice} onRemove={actions?.onRemoveMedia} />}
        <ReviewPhotos photos={photos} customerName={review.customerName} onRemove={actions?.onRemoveMedia} />
        {review.mediaDropped > 0 && <p className="text-xs text-muted-foreground">{t("media.dropped", { count: review.mediaDropped })}</p>}
      </div>
    </article>
  );
}
