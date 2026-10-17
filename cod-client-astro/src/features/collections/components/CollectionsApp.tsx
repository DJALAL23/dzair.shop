import { useEffect, useState } from "react";
import { Layers, Plus } from "lucide-react";
import { RequireAuth, canScope, useIdentity } from "@/features/auth/components/RequireAuth";
import { DashboardChrome } from "@/components/layout/chrome";
import {
  Alert,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  RowTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeleton,
} from "@/components/ui";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { SCOPES } from "../../../../../cod-shared/rbac/scopes";
import { createCollection, listCollections } from "@/features/collections/api";
import { collectionsErrorMessage, handleFromTitle, isValidHandle } from "@/features/collections/model";
import type { CollectionSummary } from "@/features/collections/types";
import { CollectionEditor } from "./CollectionEditor";

const collectionFromUrl = () => new URLSearchParams(window.location.search).get("collection");

function CollectionsContent() {
  const t = useT("collections");
  const common = useT("common");
  const canManage = canScope(useIdentity(), SCOPES.COLLECTIONS_MANAGE);
  const [collections, setCollections] = useState<CollectionSummary[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [selectedId, setSelectedId] = useState<string | null>(collectionFromUrl);
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoadError(null);
    try {
      setCollections(await listCollections());
    } catch (cause) {
      setLoadError(cause);
    }
  }

  useEffect(() => {
    void load();
    const onPop = () => setSelectedId(collectionFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function open(id: string | null) {
    window.history.pushState(null, "", id ? `/collections?collection=${encodeURIComponent(id)}` : "/collections");
    setSelectedId(id);
    document.getElementById("dashboard-main")?.scrollTo({ top: 0 });
  }

  if (selectedId) {
    return <CollectionEditor key={selectedId} collectionId={selectedId} onBack={() => open(null)} onChanged={() => void load()} />;
  }

  const header = (
    <PageHeader
      title={t("page_title")}
      subtitle={t("page_subtitle")}
      actions={
        canManage ? (
          <Button onClick={() => setCreating(true)}>
            <Plus size={15} aria-hidden="true" />
            {t("list.new_collection")}
          </Button>
        ) : undefined
      }
    />
  );

  if (loadError) {
    return (
      <>
        {header}
        <Alert role="alert" tone="critical">
          <div className="flex-1">
            <p className="font-semibold">{t("errors.load_failed")}</p>
            <button type="button" onClick={() => void load()} className="mt-3 text-xs font-semibold underline underline-offset-4">
              {common("retry")}
            </button>
          </div>
        </Alert>
      </>
    );
  }

  return (
    <>
      {header}
      {collections === null ? (
        <div role="status" aria-busy="true" className="overflow-hidden rounded-xl shadow-card">
          <TableSkeleton rows={3} columns={3} />
        </div>
      ) : collections.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Layers size={22} aria-hidden="true" />}
            title={t("list.empty_title")}
            description={t("list.empty_body")}
            action={canManage ? <Button onClick={() => setCreating(true)}>{t("list.new_collection")}</Button> : undefined}
          />
        </Card>
      ) : (
        <Card flush>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("fields.title")}</TableHead>
                <TableHead>{t("fields.handle")}</TableHead>
                <TableHead>{t("list.products")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {collections.map((collection) => (
                <TableRow key={collection.id}>
                  <TableCell>
                    <button type="button" onClick={() => open(collection.id)} className="text-start">
                      <RowTitle>{collection.title}</RowTitle>
                    </button>
                  </TableCell>
                  <TableCell>
                    <code dir="ltr" className="text-xs text-muted-foreground">{collection.handle}</code>
                  </TableCell>
                  <TableCell>{t("list.product_count", { count: collection.productCount })}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {creating && (
        <NewCollectionDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            void load();
            open(id);
          }}
        />
      )}
    </>
  );
}

function NewCollectionDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const t = useT("collections");
  const common = useT("common");
  const [title, setTitle] = useState("");
  const [handle, setHandle] = useState("");
  const [handleTouched, setHandleTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const effectiveHandle = handleTouched ? handle : handleFromTitle(title);

  async function create() {
    if (!title.trim() || !isValidHandle(effectiveHandle)) {
      setError(t("errors.validation"));
      return;
    }
    setBusy(true);
    try {
      const created = await createCollection({ title: title.trim(), handle: effectiveHandle });
      notify.success(t("list.created"));
      onCreated(created.id);
    } catch (cause) {
      setError(collectionsErrorMessage(cause, t));
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t("list.new_collection")}
      icon={<Layers size={18} aria-hidden="true" />}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {common("cancel")}
          </Button>
          <Button onClick={() => void create()} disabled={busy}>
            {t("list.create")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 py-1">
        <Field label={t("fields.title")}>
          <Input value={title} onChange={(event) => setTitle(event.currentTarget.value)} maxLength={100} autoFocus placeholder={t("fields.title_placeholder")} disabled={busy} />
        </Field>
        <Field label={t("fields.handle")} hint={t("fields.handle_hint")} error={error ?? undefined}>
          <Input
            value={effectiveHandle}
            onChange={(event) => {
              setHandleTouched(true);
              setHandle(event.currentTarget.value.toLowerCase());
            }}
            dir="ltr"
            className="font-mono"
            disabled={busy}
          />
        </Field>
      </div>
    </Dialog>
  );
}

function Gated() {
  return (
    <DashboardChrome currentPath="/collections">
      <CollectionsContent />
    </DashboardChrome>
  );
}

export default function CollectionsApp() {
  return (
    <RequireAuth>
      <Gated />
    </RequireAuth>
  );
}
