import { FolderOpen, Pencil, Trash2 } from "lucide-react";
import { IconButton, TableCell, TableRow, openRowOnClick, CellEmpty, RowActions, RowTitle } from "@/components/ui";
import { useLocale, useT } from "@/i18n/react";
import {
  formatGroupDate,
  groupCanDelete,
} from "@/features/product-groups/model";
import type { ProductCategory } from "@/features/product-groups/types";

export function GroupDesktopRow({
  group,
  groupMap,
  canManage,
  onDelete,
}: {
  group: ProductCategory;
  groupMap: Map<string, ProductCategory>;
  canManage: boolean;
  onDelete: (group: ProductCategory) => void;
}) {
  const t = useT("product-groups");
  const locale = useLocale();
  const parent = group.parentId ? groupMap.get(group.parentId) : undefined;
  return (
    <TableRow onClick={openRowOnClick(`/product-groups/${encodeURIComponent(group.id)}/edit`)} className="cursor-pointer">
      <TableCell className="max-w-80">
        <RowTitle
          href={`/product-groups/${encodeURIComponent(group.id)}/edit`}
          media={
            <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted shadow-card">
              {group.imageUrl ? (
                <img src={group.imageUrl} alt="" className="size-full object-cover" />
              ) : (
                <FolderOpen size={15} aria-hidden="true" className="text-subtle-foreground" />
              )}
            </span>
          }
        >
          {group.name}
        </RowTitle>
      </TableCell>
      <TableCell className="max-w-48 truncate text-muted-foreground">{parent?.name ?? <CellEmpty />}</TableCell>
      <TableCell numeric>{group.productsCount ?? 0}</TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {formatGroupDate(group.createdAt, locale)}
      </TableCell>
      <TableCell className="w-px">
        <RowActions>
          {canManage && (
            <a
              href={`/product-groups/${encodeURIComponent(group.id)}/edit`}
              aria-label={t("actions.edit")}
              title={t("actions.edit")}
              className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Pencil size={15} />
            </a>
          )}
          {canManage && (
            <IconButton
              type="button"
              aria-label={t("actions.delete")}
              title={t("actions.delete")}
              variant="danger"
              disabled={!groupCanDelete(group)}
              onClick={() => onDelete(group)}
            >
              <Trash2 size={15} />
            </IconButton>
          )}
        </RowActions>
      </TableCell>
    </TableRow>
  );
}

export function GroupMobileCard({
  group,
  groupMap,
  canManage,
  onDelete,
}: {
  group: ProductCategory;
  groupMap: Map<string, ProductCategory>;
  canManage: boolean;
  onDelete: (group: ProductCategory) => void;
}) {
  const t = useT("product-groups");
  const parent = group.parentId ? groupMap.get(group.parentId) : undefined;
  return (
    <article className="border-b border-border p-4 last:border-0">
      <div className="flex items-start gap-3">
        <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-muted">
          {group.imageUrl ? (
            <img
              src={group.imageUrl}
              alt={group.name}
              className="size-full object-cover"
            />
          ) : (
            <FolderOpen size={20} className="text-muted-foreground/30" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <a
            href={`/product-groups/${encodeURIComponent(group.id)}/edit`}
            className="block truncate font-medium text-foreground underline-offset-2 hover:underline"
          >
            {group.name}
          </a>
          {group.slug && (
            <p className="mt-0.5 text-[11px] text-muted-foreground/60">
              {group.slug}
            </p>
          )}
          {parent && (
            <span className="mt-2 inline-flex items-center gap-1 rounded-lg bg-muted/50 px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
              <FolderOpen size={10} className="opacity-50" />
              {parent.name}
            </span>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="rounded-lg border border-primary/10 bg-primary/5 px-2 py-1 text-sm font-medium tabular-nums text-primary">
            {group.productsCount ?? 0}
          </span>
          <div className="flex gap-1">
            {canManage && (
              <a
                href={`/product-groups/${encodeURIComponent(group.id)}/edit`}
                aria-label={t("actions.edit")}
                title={t("actions.edit")}
                className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Pencil size={15} />
              </a>
            )}
            {canManage && (
              <IconButton
                type="button"
                aria-label={t("actions.delete")}
                title={t("actions.delete")}
                variant="danger"
                disabled={!groupCanDelete(group)}
                onClick={() => onDelete(group)}
              >
                <Trash2 size={15} />
              </IconButton>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
