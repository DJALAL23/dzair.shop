import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { AlertTriangle, BadgeCheck, Loader2, Mic, Paperclip, RotateCcw, Star, X } from "lucide-react";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { Alert, Button, Dialog, Field, Input, SearchPicker, Select, SwitchField, Textarea, type PickerOption } from "@/components/ui";
import { listProducts } from "@/features/products/api";
import { listCustomers } from "@/features/customers/api";
import { createStoreReview, listReviewOrderOptions } from "@/features/reviews/api";
import { reviewErrorMessage } from "@/features/reviews/model";
import type { ReviewOrderOption } from "@/features/reviews/types";
import { useReviewFiles } from "@/features/reviews/components/useReviewFiles";
import { REVIEW_TEXT } from "../../../../../cod-shared/reviews/policy";

/**
 * Entering a review a customer gave the store — by WhatsApp, phone or in
 * person. The product, the customer (from the list, or a name), and when the
 * customer is known, one of their orders that brought the product: only a
 * delivered one shows the review as a verified purchase. Photos and a voice
 * note (a WhatsApp voice message works as it is) go up as they are picked.
 */
export function AddReviewDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const t = useT("reviews");
  const common = useT("common");
  const [product, setProduct] = useState<PickerOption | null>(null);
  const [customer, setCustomer] = useState<PickerOption | null>(null);
  const [name, setName] = useState("");
  const [orders, setOrders] = useState<ReviewOrderOption[] | null>(null);
  const [orderId, setOrderId] = useState("");
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [publish, setPublish] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(0);
  const files = useReviewFiles();
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setOrderId("");
    setOrders(null);
    if (!customer || !product) return;
    let live = true;
    listReviewOrderOptions(customer.id, product.id)
      .then((found) => live && setOrders(found))
      .catch(() => live && setOrders([]));
    return () => {
      live = false;
    };
  }, [customer?.id, product?.id]);

  const chosenOrder = orders?.find((order) => order.id === orderId) ?? null;
  const textMissing = body.trim().length < REVIEW_TEXT.bodyMin && !files.hasVoice;
  const canSave = Boolean(product) && Boolean(customer || name.trim()) && !textMissing && !files.uploading && !files.failed && !saving;

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!product || !canSave) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createStoreReview({
        productId: product.id,
        customerId: customer?.id ?? null,
        customerName: name.trim() || null,
        orderId: orderId || null,
        rating,
        title: title.trim() || null,
        body: body.trim(),
        uploads: files.uploadIds,
        publish,
      });
      notify.success(t(created.status === "processing" ? "add.done_processing" : publish ? "add.done_published" : "add.done_pending"));
      onCreated();
      onClose();
    } catch (cause) {
      setError(reviewErrorMessage(cause, t));
      setSaving(false);
    }
  }

  return (
    <Dialog
      onClose={onClose}
      preventClose={saving}
      title={t("add.title")}
      description={t("add.description")}
      className="max-w-xl"
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            {common("cancel")}
          </Button>
          <Button type="submit" form="add-review" disabled={!canSave}>
            {saving && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
            {t("add.save")}
          </Button>
        </div>
      }
    >
      <form id="add-review" onSubmit={submit} className="space-y-4">
        {error && (
          <Alert role="alert" tone="critical">
            {error}
          </Alert>
        )}
        <Field label={t("add.product")} as="div">
          <SearchPicker
            value={product}
            onChange={setProduct}
            placeholder={t("add.product_search")}
            emptyLabel={t("add.none_found")}
            search={async (search) => (await listProducts({ search, limit: 8 })).data.map((item) => ({ id: item.id, label: item.name, detail: item.sku || undefined }))}
          />
        </Field>
        <Field label={t("add.customer")} hint={t("add.customer_hint")} as="div">
          <SearchPicker
            value={customer}
            onChange={(picked) => {
              setCustomer(picked);
              if (picked && !name.trim()) setName(picked.label);
            }}
            placeholder={t("add.customer_search")}
            emptyLabel={t("add.none_found")}
            search={async (search) => (await listCustomers({ search, limit: 8 })).data.map((item) => ({ id: item.id, label: item.name, detail: item.phone }))}
          />
        </Field>
        <Field label={t("add.name")} hint={t("add.name_hint")}>
          <Input value={name} onChange={(event) => setName(event.currentTarget.value)} maxLength={REVIEW_TEXT.nameMax} dir="auto" placeholder={customer?.label ?? t("add.name_placeholder")} />
        </Field>
        {customer && product && (
          <Field
            label={t("add.order")}
            hint={
              chosenOrder?.delivered ? (
                <span className="inline-flex items-center gap-1 text-tone-success-text">
                  <BadgeCheck size={13} aria-hidden="true" />
                  {t("add.order_verified")}
                </span>
              ) : (
                t("add.order_hint")
              )
            }
          >
            <Select value={orderId} onChange={(event) => setOrderId(event.currentTarget.value)} disabled={!orders}>
              <option value="">{orders && orders.length === 0 ? t("add.order_none_found") : t("add.order_none")}</option>
              {(orders ?? []).map((order) => (
                <option key={order.id} value={order.id} disabled={order.reviewed}>
                  {`${order.orderNumber} · ${t(order.reviewed ? "add.order_reviewed" : order.delivered ? "add.order_delivered" : "add.order_not_delivered")}`}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-foreground">{t("add.rating")}</legend>
          <div className="flex gap-1" role="radiogroup" aria-label={t("add.rating")}>
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                role="radio"
                aria-checked={rating === star}
                aria-label={t("rating_label", { count: star })}
                onClick={() => setRating(star)}
                className="grid size-10 place-items-center rounded-lg hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Star size={22} aria-hidden="true" className={star <= rating ? "fill-tone-warning-text text-tone-warning-text" : "text-muted-foreground/40"} />
              </button>
            ))}
          </div>
        </fieldset>
        <Field label={t("add.review_title")}>
          <Input value={title} onChange={(event) => setTitle(event.currentTarget.value)} maxLength={REVIEW_TEXT.titleMax} dir="auto" />
        </Field>
        <Field label={t("add.body")} hint={files.hasVoice ? t("add.body_hint_voice") : t("add.body_hint", { count: REVIEW_TEXT.bodyMin })}>
          <Textarea value={body} onChange={(event) => setBody(event.currentTarget.value)} maxLength={REVIEW_TEXT.bodyMax} rows={4} dir="auto" />
        </Field>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-foreground">{t("add.files")}</span>
            <Button type="button" variant="secondary" size="sm" onClick={() => picker.current?.click()}>
              <Paperclip size={14} aria-hidden="true" />
              {t("add.files_pick")}
            </Button>
            <input
              ref={picker}
              type="file"
              multiple
              accept="image/*,audio/*,.opus,.ogg,.m4a"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                const picked = event.currentTarget.files;
                if (picked) setSkipped(files.add(picked).skipped);
                event.currentTarget.value = "";
              }}
            />
          </div>
          <p className="text-xs text-muted-foreground">{t("add.files_hint")}</p>
          {skipped > 0 && <p className="text-xs text-tone-warning-text">{t("add.files_skipped", { count: skipped })}</p>}
          {files.files.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {files.files.map((file) => (
                <li key={file.key} className="relative flex h-16 items-center gap-2 overflow-hidden rounded-lg bg-muted/60 pe-8 shadow-card">
                  {file.preview ? (
                    <img src={file.preview} alt="" className="size-16 object-cover" />
                  ) : (
                    <span className="flex items-center gap-1.5 ps-3 text-xs text-muted-foreground">
                      <Mic size={15} aria-hidden="true" />
                      <span className="max-w-32 truncate" dir="auto">{file.name}</span>
                    </span>
                  )}
                  {file.status === "uploading" && (
                    <span className="absolute inset-0 grid place-items-center bg-background/60" role="status" aria-label={t("add.file_uploading")}>
                      <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                    </span>
                  )}
                  {file.status === "error" && (
                    <button
                      type="button"
                      onClick={() => files.retry(file.key)}
                      title={reviewErrorMessage(file.error, t)}
                      aria-label={`${t("add.file_retry")}: ${reviewErrorMessage(file.error, t)}`}
                      className="absolute inset-0 grid place-items-center bg-destructive/15 text-destructive"
                    >
                      <span className="flex items-center gap-1 text-xs font-semibold">
                        <AlertTriangle size={14} aria-hidden="true" />
                        <RotateCcw size={14} aria-hidden="true" />
                      </span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => files.remove(file.key)}
                    aria-label={`${common("remove")}: ${file.name}`}
                    className="absolute end-1 top-1 grid size-6 place-items-center rounded-md bg-background/90 text-muted-foreground hover:text-foreground"
                  >
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <SwitchField label={t("add.publish")} help={t("add.publish_hint")} checked={publish} onChange={setPublish} />
      </form>
    </Dialog>
  );
}
