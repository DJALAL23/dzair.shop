import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CornerDownRight,
  CornerUpLeft,
  Languages,
  ListTree,
  Pencil,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { canScope, useIdentity } from "@/features/auth/components/RequireAuth";
import { Alert, Badge, Button, Card, Dialog, EmptyState, Field, IconButton, Input, Skeleton, useConfirmDialog } from "@/components/ui";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { SCOPES } from "../../../../../cod-shared/rbac/scopes";
import { deleteMenu, getMenu, saveMenuItems, updateMenu } from "@/features/navigation/api";
import {
  addItem,
  canIndent,
  canMove,
  canOutdent,
  countItems,
  depthOf,
  fromServer,
  indentItem,
  isValidHandle,
  MENU_MAX_DEPTH,
  MENU_MAX_ITEMS,
  menusErrorMessage,
  moveItem,
  newKey,
  outdentItem,
  removeItem,
  toInput,
  treeProblem,
  updateItem,
  type EditableItem,
} from "@/features/navigation/model";
import type { MenuDetail } from "@/features/navigation/types";
import { TranslationsCard } from "@/features/translations/components/TranslationsCard";
import { MenuItemDialog, type ItemChange } from "./MenuItemDialog";

type Editing = { mode: "add"; parentKey: string | null } | { mode: "edit"; item: EditableItem };

/** One menu: its name and handle, and its items as a tree saved at once. */
export function MenuEditor({ menuId, onBack, onChanged }: { menuId: string; onBack: () => void; onChanged: () => void }) {
  const t = useT("menus");
  const common = useT("common");
  const confirm = useConfirmDialog();
  const canManage = canScope(useIdentity(), SCOPES.NAVIGATION_MANAGE);

  const [menu, setMenu] = useState<MenuDetail | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [items, setItems] = useState<EditableItem[]>([]);
  const [dirty, setDirty] = useState(false);
  const [title, setTitle] = useState("");
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [translating, setTranslating] = useState<EditableItem | null>(null);

  function show(detail: MenuDetail) {
    setMenu(detail);
    setItems(fromServer(detail.items));
    setTitle(detail.title);
    setHandle(detail.handle);
    setDirty(false);
  }

  useEffect(() => {
    getMenu(menuId).then(show, setLoadError);
  }, [menuId]);

  function edit(next: EditableItem[]) {
    setItems(next);
    setDirty(true);
  }

  async function leave() {
    if (dirty && !(await confirm({ title: t("editor.unsaved_title"), description: t("editor.unsaved_body"), confirmLabel: t("editor.leave"), tone: "danger" }))) return;
    onBack();
  }

  async function saveItems() {
    const problem = treeProblem(items);
    if (problem) {
      notify.error(problem === "too_many" ? t("errors.over_limit", { max: MENU_MAX_ITEMS }) : t("errors.item_incomplete"));
      return;
    }
    setBusy(true);
    try {
      show(await saveMenuItems(menuId, toInput(items)));
      notify.success(t("editor.saved"));
      onChanged();
    } catch (cause) {
      notify.error(menusErrorMessage(cause, t));
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
      const saved = await updateMenu(menuId, { title: title.trim(), handle });
      setMenu(saved);
      setTitle(saved.title);
      setHandle(saved.handle);
      notify.success(t("editor.saved"));
      onChanged();
    } catch (cause) {
      notify.error(menusErrorMessage(cause, t));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!menu) return;
    const ok = await confirm({
      title: t("editor.delete_title"),
      description: t("editor.delete_body", { title: menu.title }),
      confirmLabel: common("delete"),
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteMenu(menuId);
      notify.success(t("editor.deleted"));
      onChanged();
      onBack();
    } catch (cause) {
      notify.error(menusErrorMessage(cause, t));
      setBusy(false);
    }
  }

  function applyItem(change: ItemChange) {
    if (!editing) return;
    if (editing.mode === "add") {
      edit(addItem(items, { key: newKey(), ...change, destinationStatus: null, children: [] }, editing.parentKey));
    } else {
      const moved = JSON.stringify(editing.item.destination) !== JSON.stringify(change.destination);
      edit(updateItem(items, editing.item.key, { ...change, ...(moved ? { destinationStatus: null } : {}) }));
    }
    setEditing(null);
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
        <Alert role="alert" tone="critical">{menusErrorMessage(loadError, t)}</Alert>
      </>
    );
  }
  if (!menu) {
    return (
      <div role="status" aria-busy="true" className="space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const detailsChanged = title.trim() !== menu.title || handle !== menu.handle;
  const unreachable = (function count(list: EditableItem[]): number {
    return list.reduce((sum, item) => sum + (item.destinationStatus === "missing" || item.destinationStatus === "hidden" ? 1 : 0) + count(item.children), 0);
  })(items);

  return (
    <div className="space-y-4">
      <div>
        {back}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-foreground">{menu.title}</h1>
          {canManage && (
            <div className="flex gap-2">
              <Button variant="dangerOutline" onClick={() => void remove()} disabled={busy}>
                <Trash2 size={15} aria-hidden="true" />
                {t("editor.delete")}
              </Button>
              <Button onClick={() => void saveItems()} disabled={busy || !dirty}>
                <Save size={15} aria-hidden="true" />
                {t("editor.save")}
              </Button>
            </div>
          )}
        </div>
      </div>

      {unreachable > 0 && <Alert tone="warning">{t("editor.unreachable", { count: unreachable })}</Alert>}

      <Card
        title={t("editor.items_title")}
        subtitle={t("editor.items_subtitle", { depth: MENU_MAX_DEPTH })}
        action={
          canManage ? (
            <Button variant="secondary" size="sm" onClick={() => setEditing({ mode: "add", parentKey: null })} disabled={countItems(items) >= MENU_MAX_ITEMS}>
              <Plus size={14} aria-hidden="true" />
              {t("editor.add_item")}
            </Button>
          ) : undefined
        }
      >
        {items.length === 0 ? (
          <EmptyState compact icon={<ListTree size={20} aria-hidden="true" />} title={t("editor.empty_title")} description={t("editor.empty_body")} />
        ) : (
          <ul role="tree" aria-label={menu.title} className="divide-y divide-border/60">
            {items.map((item) => (
              <ItemRow
                key={item.key}
                item={item}
                items={items}
                canManage={canManage}
                onEdit={(target) => setEditing({ mode: "edit", item: target })}
                onAddChild={(target) => setEditing({ mode: "add", parentKey: target.key })}
                onTranslate={setTranslating}
                onChange={edit}
              />
            ))}
          </ul>
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
        </div>
        {canManage && (
          <div className="mt-4 flex justify-end">
            <Button variant="secondary" onClick={() => void saveDetails()} disabled={busy || !detailsChanged}>
              {t("editor.save_details")}
            </Button>
          </div>
        )}
      </Card>

      {editing && <MenuItemDialog item={editing.mode === "edit" ? editing.item : null} onSave={applyItem} onClose={() => setEditing(null)} />}

      {translating?.id && (
        <Dialog open onClose={() => setTranslating(null)} title={t("item.translate_title", { label: translating.label })} icon={<Languages size={18} aria-hidden="true" />} className="max-w-2xl">
          <TranslationsCard resource="menuItem" id={translating.id} canEdit={canManage} />
        </Dialog>
      )}
    </div>
  );
}

function ItemRow({
  item,
  items,
  canManage,
  onEdit,
  onAddChild,
  onTranslate,
  onChange,
}: {
  item: EditableItem;
  items: EditableItem[];
  canManage: boolean;
  onEdit: (item: EditableItem) => void;
  onAddChild: (item: EditableItem) => void;
  onTranslate: (item: EditableItem) => void;
  onChange: (items: EditableItem[]) => void;
}) {
  const t = useT("menus");
  const depth = depthOf(items, item.key);
  const where =
    item.destination.type === "url"
      ? item.destination.url
      : item.destinationLabel
        ? `${t(`destination.${item.destination.type}`)} · ${item.destinationLabel}`
        : t(`destination.${item.destination.type}`);

  return (
    <li role="treeitem" aria-level={depth} aria-selected={false} className="py-1">
      <div className="flex flex-wrap items-center gap-2 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{item.label}</p>
          <p className="truncate text-xs text-muted-foreground" dir={item.destination.type === "url" ? "ltr" : undefined}>
            {where}
          </p>
        </div>
        {item.destinationStatus === "missing" && <Badge tone="critical">{t("status.missing")}</Badge>}
        {item.destinationStatus === "hidden" && <Badge tone="warning">{t("status.hidden")}</Badge>}
        {item.destinationStatus === null && <Badge tone="neutral">{t("status.unsaved")}</Badge>}
        <div className="flex items-center">
          {item.id && (
            <IconButton size="sm" onClick={() => onTranslate(item)} aria-label={t("actions.translate")} title={t("actions.translate")}>
              <Languages size={14} />
            </IconButton>
          )}
          {canManage && (
            <>
              <IconButton size="sm" onClick={() => onEdit(item)} aria-label={t("actions.edit")} title={t("actions.edit")}>
                <Pencil size={14} />
              </IconButton>
              {depth < MENU_MAX_DEPTH && (
                <IconButton size="sm" onClick={() => onAddChild(item)} aria-label={t("actions.add_child")} title={t("actions.add_child")}>
                  <Plus size={14} />
                </IconButton>
              )}
              <IconButton size="sm" onClick={() => onChange(moveItem(items, item.key, "up"))} disabled={!canMove(items, item.key, "up")} aria-label={t("actions.up")} title={t("actions.up")}>
                <ArrowUp size={14} />
              </IconButton>
              <IconButton size="sm" onClick={() => onChange(moveItem(items, item.key, "down"))} disabled={!canMove(items, item.key, "down")} aria-label={t("actions.down")} title={t("actions.down")}>
                <ArrowDown size={14} />
              </IconButton>
              <IconButton size="sm" onClick={() => onChange(indentItem(items, item.key))} disabled={!canIndent(items, item.key)} aria-label={t("actions.indent")} title={t("actions.indent")}>
                <CornerDownRight size={14} className="rtl:-scale-x-100" />
              </IconButton>
              <IconButton size="sm" onClick={() => onChange(outdentItem(items, item.key))} disabled={!canOutdent(items, item.key)} aria-label={t("actions.outdent")} title={t("actions.outdent")}>
                <CornerUpLeft size={14} className="rtl:-scale-x-100" />
              </IconButton>
              <IconButton size="sm" variant="danger" onClick={() => onChange(removeItem(items, item.key))} aria-label={t("actions.remove")} title={t("actions.remove")}>
                <Trash2 size={14} />
              </IconButton>
            </>
          )}
        </div>
      </div>
      {item.children.length > 0 && (
        <ul role="group" className="ms-3 border-s border-border/60 ps-3">
          {item.children.map((child) => (
            <ItemRow key={child.key} item={child} items={items} canManage={canManage} onEdit={onEdit} onAddChild={onAddChild} onTranslate={onTranslate} onChange={onChange} />
          ))}
        </ul>
      )}
    </li>
  );
}
