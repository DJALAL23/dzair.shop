import { useEffect, useState } from "react";
import { ListTree, Plus } from "lucide-react";
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
import { createMenu, listMenus } from "@/features/navigation/api";
import { handleFromTitle, isValidHandle, menusErrorMessage } from "@/features/navigation/model";
import type { MenuSummary } from "@/features/navigation/types";
import { MenuEditor } from "./MenuEditor";

const menuFromUrl = () => new URLSearchParams(window.location.search).get("menu");

function NavigationContent() {
  const t = useT("menus");
  const common = useT("common");
  const canManage = canScope(useIdentity(), SCOPES.NAVIGATION_MANAGE);
  const [menus, setMenus] = useState<MenuSummary[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [selectedId, setSelectedId] = useState<string | null>(menuFromUrl);
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoadError(null);
    try {
      setMenus(await listMenus());
    } catch (cause) {
      setLoadError(cause);
    }
  }

  useEffect(() => {
    void load();
    const onPop = () => setSelectedId(menuFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function open(id: string | null) {
    window.history.pushState(null, "", id ? `/navigation?menu=${encodeURIComponent(id)}` : "/navigation");
    setSelectedId(id);
    document.getElementById("dashboard-main")?.scrollTo({ top: 0 });
  }

  if (selectedId) {
    return <MenuEditor key={selectedId} menuId={selectedId} onBack={() => open(null)} onChanged={() => void load()} />;
  }

  const header = (
    <PageHeader
      title={t("page_title")}
      subtitle={t("page_subtitle")}
      actions={
        canManage ? (
          <Button onClick={() => setCreating(true)}>
            <Plus size={15} aria-hidden="true" />
            {t("list.new_menu")}
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
      {menus === null ? (
        <div role="status" aria-busy="true" className="overflow-hidden rounded-xl shadow-card">
          <TableSkeleton rows={3} columns={3} />
        </div>
      ) : menus.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ListTree size={22} aria-hidden="true" />}
            title={t("list.empty_title")}
            description={t("list.empty_body")}
            action={canManage ? <Button onClick={() => setCreating(true)}>{t("list.new_menu")}</Button> : undefined}
          />
        </Card>
      ) : (
        <Card flush>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("fields.title")}</TableHead>
                <TableHead>{t("fields.handle")}</TableHead>
                <TableHead>{t("list.items")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {menus.map((menu) => (
                <TableRow key={menu.id}>
                  <TableCell>
                    <button type="button" onClick={() => open(menu.id)} className="text-start">
                      <RowTitle>{menu.title}</RowTitle>
                    </button>
                  </TableCell>
                  <TableCell>
                    <code dir="ltr" className="text-xs text-muted-foreground">{menu.handle}</code>
                  </TableCell>
                  <TableCell>{t("list.item_count", { count: menu.itemCount })}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {creating && (
        <NewMenuDialog
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

function NewMenuDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const t = useT("menus");
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
      const menu = await createMenu({ title: title.trim(), handle: effectiveHandle });
      notify.success(t("list.created"));
      onCreated(menu.id);
    } catch (cause) {
      setError(menusErrorMessage(cause, t));
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t("list.new_menu")}
      icon={<ListTree size={18} aria-hidden="true" />}
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
    <DashboardChrome currentPath="/navigation">
      <NavigationContent />
    </DashboardChrome>
  );
}

export default function NavigationApp() {
  return (
    <RequireAuth>
      <Gated />
    </RequireAuth>
  );
}
