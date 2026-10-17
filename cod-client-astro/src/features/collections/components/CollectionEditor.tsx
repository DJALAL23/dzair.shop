import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, EyeOff, Layers, Save, Trash2, X } from "lucide-react";
import { canScope, useIdentity } from "@/features/auth/components/RequireAuth";
import { Alert, Badge, Button, Card, EmptyState, Field, IconButton, Input, SearchPicker, Skeleton, Textarea, useConfirmDialog, type PickerOption } from "@/components/ui";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { SCOPES } from "../../../../../cod-shared/rbac/scopes";
import { deleteCollection, getCollection, saveCollectionProducts, updateCollection } from "@/features/collections/api";
import { COLLECTION_MAX_PRODUCTS, addLast, collectionsErrorMessage, isValidHandle, move } from "@/features/collections/model";
import type { CollectionDetail, CollectionProduct } from "@/features/collections/types";
import { listProducts } from "@/features/products/api";
import { TranslationsCard } from "@/features/translations/components/TranslationsCard";

/** One collection: its name and handle, and its products in the merchant's order. */
export function CollectionEditor({ collectionId, onBack, onChanged }: { collectionId: string; onBack: () => void; onChanged: () => void }) {
  const t = useT("collections");
  const common = useT("common");
  const confirm = useConfirmDialog();
  const canManage = canScope(useIdentity(), SCOPES.COLLECTIONS_MANAGE);

  const [collection, setCollection] = useState<CollectionDetail | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [products, setProducts] = useState<CollectionProduct[]>([]);
  const [dirty, setDirty] = useState(false);
  const [title, setTitle] = useState("");
  const [handle, setHandle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  /** The products the picker last offered, by id, to add the one picked. */
  const offered = useRef(new Map<string, CollectionProduct>());

  function show(detail: CollectionDetail) {
    setCollection(detail);
    setProducts(detail.products);
    setTitle(detail.title);
    setHandle(detail.handle);
    setDescription(detail.description ?? "");
    setDirty(false);
  }

  useEffect(() => {
    getCollection(collectionId).then(show, setLoadError);
  }, [collectionId]);

  function edit(next: CollectionProduct[]) {
    setProducts(next);
    setDirty(true);
  }

  async function leave() {
    if (dirty && !(await confirm({ title: t("editor.unsaved_title"), description: t("editor.unsaved_body"), confirmLabel: t("editor.leave"), tone: "danger" }))) return;
    onBack();
  }

  async function saveProducts() {
    setBusy(true);
    try {
      show(await saveCollectionProducts(collectionId, products.map((product) => product.id)));
      notify.success(t("editor.saved"));
      onChanged();
    } catch (cause) {
      notify.error(collectionsErrorMessage(cause, t));
    } finally {
      setBusy(false);
    }
  }

  async function saveDetails() {
    if (!title.trim() || !isValidHandle(handle)) {
      notify.error(t("errors.validation"));
      return;
    }
    setBusy(true);
    try {
      const saved = await updateCollection(collectionId, { title: title.trim(), handle, description: description.trim() || null });
      setCollection(saved);
      notify.success(t("editor.saved"));
      onChanged();
    } catch (cause) {
      notify.error(collectionsErrorMessage(cause, t));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!collection) return;
    const ok = await confirm({ title: t("editor.delete_title"), description: t("editor.delete_body", { title: collection.title }), confirmLabel: common("delete"), tone: "danger" });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteCollection(collectionId);
      notify.success(t("editor.deleted"));
      onChanged();
      onBack();
    } catch (cause) {
      notify.error(collectionsErrorMessage(cause, t));
      setBusy(false);
    }
  }

  async function search(query: string): Promise<PickerOption[]> {
    const found = (await listProducts({ search: query || undefined, limit: 20 })).data.filter((product) => !products.some((entry) => entry.id === product.id));
    offered.current = new Map(
      found.map((product) => [
        product.id,
        {
          id: product.id,
          name: product.name,
          handle: product.handle,
          imageUrl: product.primaryImageSrc ?? null,
          visible: product.status === "ACTIVE" && product.visibility && product.showInStore,
        },
      ]),
    );
    return found.map((product) => ({ id: product.id, label: product.name, detail: product.sku ?? product.handle }));
  }

  function add(option: PickerOption | null) {
    const product = option && offered.current.get(option.id);
    if (product) edit(addLast(products, product));
  }

  const back = (
    <button type="button" onClick={() => void leave()} className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
      <ArrowLeft size={15} aria-hidden="true" className="rtl:rotate-180" />
      {t("editor.back")}
    </button>
  );

  if (loadError) {
    return (
      <>
        {back}
        <Alert role="alert" tone="critical">{collectionsErrorMessage(loadError, t)}</Alert>
      </>
    );
  }
  if (!collection) {
    return (
      <div role="status" aria-busy="true" className="space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const detailsChanged = title.trim() !== collection.title || handle !== collection.handle || (description.trim() || null) !== collection.description;
  const hidden = products.filter((product) => !product.visible).length;

  return (
    <div className="space-y-4">
      <div>
        {back}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-foreground">{collection.title}</h1>
          {canManage && (
            <div className="flex gap-2">
              <Button variant="dangerOutline" onClick={() => void remove()} disabled={busy}>
                <Trash2 size={15} aria-hidden="true" />
                {t("editor.delete")}
              </Button>
              <Button onClick={() => void saveProducts()} disabled={busy || !dirty}>
                <Save size={15} aria-hidden="true" />
                {t("editor.save")}
              </Button>
            </div>
          )}
        </div>
      </div>

      {hidden > 0 && <Alert tone="warning">{t("editor.hidden", { count: hidden })}</Alert>}

      <Card title={t("editor.products_title")} subtitle={t("editor.products_subtitle", { max: COLLECTION_MAX_PRODUCTS })}>
        {canManage && (
          <div className="mb-4">
            <SearchPicker value={null} onChange={add} search={search} placeholder={t("editor.add_placeholder")} emptyLabel={t("editor.add_empty")} aria-label={t("editor.add_placeholder")} />
          </div>
        )}
        {products.length === 0 ? (
          <EmptyState compact icon={<Layers size={20} aria-hidden="true" />} title={t("editor.empty_title")} description={t("editor.empty_body")} />
        ) : (
          <ol className="divide-y divide-border/60">
            {products.map((product, index) => (
              <li key={product.id} className="flex items-center gap-3 py-2">
                <span className="w-6 shrink-0 text-center text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                {product.imageUrl ? (
                  <img src={product.imageUrl} alt="" className="size-10 shrink-0 rounded-md object-cover" loading="lazy" />
                ) : (
                  <span className="size-10 shrink-0 rounded-md bg-muted" aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{product.name}</span>
                {!product.visible && (
                  <Badge tone="warning">
                    <EyeOff size={12} aria-hidden="true" />
                    {t("editor.not_visible")}
                  </Badge>
                )}
                {canManage && (
                  <div className="flex items-center">
                    <IconButton size="sm" onClick={() => edit(move(products, index, "up"))} disabled={index === 0} aria-label={t("actions.up")} title={t("actions.up")}>
                      <ArrowUp size={14} />
                    </IconButton>
                    <IconButton size="sm" onClick={() => edit(move(products, index, "down"))} disabled={index === products.length - 1} aria-label={t("actions.down")} title={t("actions.down")}>
                      <ArrowDown size={14} />
                    </IconButton>
                    <IconButton size="sm" variant="danger" onClick={() => edit(products.filter((entry) => entry.id !== product.id))} aria-label={t("actions.remove")} title={t("actions.remove")}>
                      <X size={14} />
                    </IconButton>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card title={t("editor.details_title")} subtitle={t("editor.details_subtitle")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("fields.title")}>
            <Input value={title} onChange={(event) => setTitle(event.currentTarget.value)} maxLength={100} disabled={!canManage || busy} />
          </Field>
          <Field label={t("fields.handle")} hint={t("fields.handle_hint")} error={isValidHandle(handle) ? undefined : t("fields.handle_invalid")}>
            <Input value={handle} onChange={(event) => setHandle(event.currentTarget.value.toLowerCase())} dir="ltr" className="font-mono" disabled={!canManage || busy} />
          </Field>
          <Field label={t("fields.description")} className="sm:col-span-2">
            <Textarea value={description} onChange={(event) => setDescription(event.currentTarget.value)} maxLength={1000} rows={3} disabled={!canManage || busy} />
          </Field>
        </div>
        {canManage && (
          <div className="mt-4 flex justify-end">
            <Button variant="secondary" onClick={() => void saveDetails()} disabled={busy || !detailsChanged}>
              {t("editor.save_details")}
            </Button>
          </div>
        )}
      </Card>

      <TranslationsCard resource="collection" id={collection.id} canEdit={canManage} />
    </div>
  );
}
