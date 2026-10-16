import { Pencil, Trash2 } from "lucide-react";
import { CellEmpty, IconButton, Initial, RowActions, RowTitle, TableCell, TableRow, openRowOnClick } from "@/components/ui";
import { useLocale, useT } from "@/i18n/react";
import { customerCanDelete } from "@/features/customers/model";
import { formatMoney } from "@/features/orders/model";
import type { Customer } from "@/features/customers/types";

interface RowProps {
  customer: Customer;
  canEdit: boolean;
  canDelete: boolean;
  onDelete: (customer: Customer) => void;
}

function profileHref(customer: Customer) {
  return `/customers/${encodeURIComponent(customer.id)}`;
}

export function CustomerDesktopRow({ customer, canEdit, canDelete, onDelete }: RowProps) {
  const t = useT("customers");
  const locale = useLocale();
  return (
    <TableRow onClick={openRowOnClick(profileHref(customer))} className="cursor-pointer">
      <TableCell className="max-w-64">
        <RowTitle href={profileHref(customer)} media={<Initial name={customer.name} />}>
          {customer.name}
        </RowTitle>
      </TableCell>
      <TableCell className="tabular-nums whitespace-nowrap text-muted-foreground">
        <span dir="ltr">{customer.phone}</span>
      </TableCell>
      <TableCell className="max-w-40 truncate text-muted-foreground">{customer.wilaya || <CellEmpty />}</TableCell>
      <TableCell numeric>{customer.totalOrders}</TableCell>
      <TableCell numeric>{formatMoney(customer.totalSpent, locale)}</TableCell>
      <TableCell className="w-px">
        <RowActions>
          {canEdit && (
            <a
              href={`${profileHref(customer)}/edit`}
              aria-label={t("actions.edit")}
              title={t("actions.edit")}
              className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
            >
              <Pencil size={15} aria-hidden="true" />
            </a>
          )}
          {canDelete && (
            <IconButton
              type="button"
              aria-label={t("actions.delete")}
              title={t("actions.delete")}
              variant="danger"
              disabled={!customerCanDelete(customer)}
              onClick={() => onDelete(customer)}
            >
              <Trash2 size={15} aria-hidden="true" />
            </IconButton>
          )}
        </RowActions>
      </TableCell>
    </TableRow>
  );
}

export function CustomerMobileCard({ customer }: Pick<RowProps, "customer">) {
  const t = useT("customers");
  const locale = useLocale();
  return (
    <a href={profileHref(customer)} className="flex items-center gap-3 px-4 py-3 transition-colors active:bg-subtle">
      <Initial name={customer.name} className="size-9" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{customer.name}</span>
        <span dir="ltr" className="block truncate text-start text-xs tabular-nums text-muted-foreground">
          {customer.phone}
        </span>
      </span>
      <span className="shrink-0 text-end">
        <span className="block text-sm font-medium tabular-nums text-foreground">{formatMoney(customer.totalSpent, locale)}</span>
        <span className="block text-xs text-muted-foreground">{t("orders_count", { count: customer.totalOrders })}</span>
      </span>
    </a>
  );
}
