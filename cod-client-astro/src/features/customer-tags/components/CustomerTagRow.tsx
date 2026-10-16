import { Pencil, Trash2, Users } from "lucide-react";
import { IconButton, TableCell, TableRow, openRowOnClick, RowActions } from "@/components/ui";
import { useLocale, useT } from "@/i18n/react";
import {
  formatTagDate,
  tagCanDelete,
} from "@/features/customer-tags/model";
import type { CustomerTag } from "@/features/customer-tags/types";

export function TagDesktopRow({
  tag,
  canManage,
  onDelete,
}: {
  tag: CustomerTag;
  canManage: boolean;
  onDelete: (tag: CustomerTag) => void;
}) {
  const t = useT("customer-tags");
  const locale = useLocale();
  return (
    <TableRow onClick={openRowOnClick(`/customer-tags/${encodeURIComponent(tag.id)}`)} className="cursor-pointer">
      <TableCell>
        <a
          href={`/customer-tags/${encodeURIComponent(tag.id)}`}
          className="inline-flex min-w-0 items-center gap-2.5 font-medium text-foreground underline-offset-2 hover:underline"
        >
          <span
            aria-hidden="true"
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: tag.color }}
          />
          <span className="truncate">{tag.name}</span>
        </a>
      </TableCell>
      <TableCell numeric>{tag.assignmentCount}</TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {formatTagDate(tag.createdAt, locale)}
      </TableCell>
      <TableCell className="w-px">
        <RowActions>
          {canManage && (
            <a
              href={`/customer-tags/${encodeURIComponent(tag.id)}/edit`}
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
              disabled={!tagCanDelete(tag)}
              onClick={() => onDelete(tag)}
            >
              <Trash2 size={15} />
            </IconButton>
          )}
        </RowActions>
      </TableCell>
    </TableRow>
  );
}

export function TagMobileCard({
  tag,
  canManage,
  onDelete,
}: {
  tag: CustomerTag;
  canManage: boolean;
  onDelete: (tag: CustomerTag) => void;
}) {
  const t = useT("customer-tags");
  const locale = useLocale();
  return (
    <article className="border-b border-border p-4 last:border-0">
      <div className="flex items-start gap-3">
        <span
          className="mt-1 size-3 shrink-0 rounded-sm border border-border"
          style={{ backgroundColor: tag.color }}
        />
        <a
          href={`/customer-tags/${encodeURIComponent(tag.id)}`}
          className="min-w-0 flex-1 truncate font-medium text-foreground underline-offset-2 hover:underline"
        >
          {tag.name}
        </a>
        <div className="flex gap-1">
          {canManage && (
            <a
              href={`/customer-tags/${encodeURIComponent(tag.id)}/edit`}
              aria-label={t("actions.edit")}
              title={t("actions.edit")}
              className="grid size-10 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
              disabled={!tagCanDelete(tag)}
              onClick={() => onDelete(tag)}
            >
              <Trash2 size={15} />
            </IconButton>
          )}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3 text-xs">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Users size={13} />
          <strong className="ms-1 text-foreground">
            {tag.assignmentCount}
          </strong>
          {t("table.customers")}
        </span>
        <span className="text-end text-muted-foreground">
          {formatTagDate(tag.createdAt, locale)}
        </span>
      </div>
    </article>
  );
}
