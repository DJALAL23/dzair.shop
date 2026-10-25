import { useCallback, useEffect, useState } from "react";
import { Plus, Star, X } from "lucide-react";
import { canScope, RequireAuth, useIdentity } from "@/features/auth/components/RequireAuth";
import { DashboardPage } from "@/components/layout/page";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { SCOPES } from "../../../../../cod-shared/rbac/scopes";
import { deleteReview, deleteReviewMedia, listReviews, updateReviewStatus } from "@/features/reviews/api";
import { buildReviewsUrl, readReviewView, reviewErrorMessage, type ReviewView } from "@/features/reviews/model";
import type { Review, ReviewListResult, ReviewMedia, ReviewStatus } from "@/features/reviews/types";
import { ReviewCard } from "@/features/reviews/components/ReviewCard";
import { AddReviewDialog } from "@/features/reviews/components/AddReviewDialog";
import { Alert, Button, EmptyState, FilterPill, ListToolbar, PageHeader, Pagination, Tabs, useConfirmDialog } from "@/components/ui";

const LIMIT = 20;
const STATUS_TABS: Array<ReviewStatus | "all"> = ["all", "pending", "approved", "rejected"];

function ReviewSkeleton() {
  return (
    <div role="status" aria-busy="true" className="divide-y divide-border rounded-xl bg-card shadow-card">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="flex gap-3 p-4">
          <span className="size-7 shimmer rounded-full" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-40 shimmer rounded" />
            <div className="h-3 w-24 shimmer rounded" />
            <div className="h-3 w-3/4 shimmer rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The reviews the merchant works through: what waits for a decision first,
 * each review with its photos and voice note, and — for staff who may — the
 * reviews customers gave the store by WhatsApp, phone or in person.
 */
function ReviewsList({ refresh }: { refresh: number }) {
  const t = useT("reviews");
  const common = useT("common");
  const auth = useT("auth");
  const identity = useIdentity();
  const confirm = useConfirmDialog();
  const [view] = useState<ReviewView>(() => readReviewView(window.location.search));
  const [result, setResult] = useState<ReviewListResult | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const may = (scope: string) => canScope(identity, scope);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setResult(
        await listReviews({
          status: view.status === "all" ? undefined : view.status,
          source: view.source === "all" ? undefined : view.source,
          withMedia: view.withMedia,
          limit: LIMIT,
          offset: (view.page - 1) * LIMIT,
        }),
      );
    } catch (cause) {
      setLoadError(cause);
    }
  }, [view]);

  useEffect(() => {
    if (may(SCOPES.REVIEWS_READ)) void load();
  }, [load, refresh, identity?.role, identity?.scopes.join(",")]);

  if (!may(SCOPES.REVIEWS_READ)) return <Alert role="alert" tone="critical">{auth("no_access")}</Alert>;
  if (loadError) {
    return (
      <Alert role="alert" tone="critical">
        <div className="flex-1">
          <p className="font-semibold">{t("error_load")}</p>
          <button type="button" onClick={() => void load()} className="mt-3 text-xs font-semibold underline underline-offset-4">
            {common("retry")}
          </button>
        </div>
      </Alert>
    );
  }
  if (result === null) return <ReviewSkeleton />;

  const totalPages = Math.max(1, Math.ceil(result.total / LIMIT));
  const go = (next: Partial<ReviewView>) => window.location.assign(buildReviewsUrl({ ...view, page: 1, ...next }));
  const filtered = view.source !== "all" || view.withMedia;

  async function run(review: Review, action: () => Promise<unknown>, success: string) {
    setBusyId(review.id);
    setActionError(null);
    try {
      await action();
      await load();
      notify.success(success);
      return true;
    } catch (cause) {
      const message = reviewErrorMessage(cause, t);
      setActionError(message);
      notify.error(message);
      return false;
    } finally {
      setBusyId(null);
    }
  }

  function actionsFor(review: Review) {
    if (!may(SCOPES.REVIEWS_MANAGE)) return null;
    return {
      busy: busyId === review.id,
      onStatus: (status: ReviewStatus) => void run(review, () => updateReviewStatus(review.id, status), t(`toast_${status}`)),
      onDelete: async () => {
        const accepted = await confirm({
          title: t("confirm_delete_title"),
          description: t("confirm_delete_desc", { name: review.customerName }),
          consequences: review.media.length ? [{ text: t("confirm_delete_media", { count: review.media.length }) }] : undefined,
          confirmLabel: t("confirm_delete_label"),
          tone: "danger",
        });
        if (accepted) await run(review, () => deleteReview(review.id), t("toast_deleted"));
      },
      onRemoveMedia: async (media: ReviewMedia) => {
        const accepted = await confirm({
          title: t(media.kind === "image" ? "media.remove_photo_title" : "media.remove_voice_title"),
          description: t("media.remove_description", { name: review.customerName }),
          confirmLabel: common("remove"),
          tone: "danger",
        });
        return accepted ? run(review, () => deleteReviewMedia(review.id, media.id), t("media.removed")) : false;
      },
    };
  }

  return (
    <div className="space-y-3">
      {actionError && (
        <Alert role="alert" tone="critical">
          <span className="flex-1">{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} aria-label={common("close")}>
            <X size={16} />
          </button>
        </Alert>
      )}
      <div className="rounded-xl bg-card shadow-card">
        <Tabs
          className="px-2 pt-2"
          label={t("table.status")}
          value={view.status}
          onChange={(status) => go({ status })}
          items={STATUS_TABS.map((key) => ({ key, label: t(`filter_${key}`), count: key === "pending" ? result.pendingCount : undefined }))}
        />
        <ListToolbar count={t("total", { count: result.total })}>
          <FilterPill label={t("filters.source")} value={view.source} onChange={(source) => go({ source: source as ReviewView["source"] })}>
            <option value="all">{t("filters.source_all")}</option>
            <option value="storefront">{t("filters.source_storefront")}</option>
            <option value="merchant">{t("filters.source_merchant")}</option>
          </FilterPill>
          <FilterPill label={t("filters.media")} value={view.withMedia ? "1" : ""} onChange={(value) => go({ withMedia: value === "1" })}>
            <option value="">{t("filters.media_any")}</option>
            <option value="1">{t("filters.media_with")}</option>
          </FilterPill>
          {filtered && (
            <Button type="button" variant="ghost" size="sm" onClick={() => go({ source: "all", withMedia: false })}>
              {t("filters.clear")}
            </Button>
          )}
        </ListToolbar>
        {result.rows.length === 0 ? (
          <EmptyState icon={<Star size={22} />} title={filtered || view.status !== "all" ? common("no_results_found") : t("empty_title")} description={filtered || view.status !== "all" ? undefined : t("empty_desc")} />
        ) : (
          <>
            <div className="divide-y divide-border border-t border-border">
              {result.rows.map((review) => (
                <ReviewCard key={review.id} review={review} actions={actionsFor(review)} />
              ))}
            </div>
            <Pagination page={Math.min(view.page, totalPages)} totalPages={totalPages} total={result.total} pageSize={LIMIT} onPageChange={(page) => window.location.assign(buildReviewsUrl({ ...view, page }))} />
          </>
        )}
      </div>
    </div>
  );
}

function Gated() {
  const t = useT("reviews");
  const identity = useIdentity();
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(0);
  return (
    <DashboardPage>
      <PageHeader
        title={t("page_title")}
        actions={
          canScope(identity, SCOPES.REVIEWS_CREATE) ? (
            <Button type="button" onClick={() => setAdding(true)}>
              <Plus size={16} aria-hidden="true" />
              {t("add.open")}
            </Button>
          ) : undefined
        }
      />
      <ReviewsList refresh={added} />
      {adding && <AddReviewDialog onClose={() => setAdding(false)} onCreated={() => setAdded((n) => n + 1)} />}
    </DashboardPage>
  );
}

export default function ReviewsPageApp() {
  return (
    <RequireAuth>
      <Gated />
    </RequireAuth>
  );
}
