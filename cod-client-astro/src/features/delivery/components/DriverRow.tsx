import { DollarSign, Eye, MoreHorizontal, Package, Pencil, Trash2 } from "lucide-react";
import {
  CellEmpty,
  DropdownItem,
  DropdownMenu,
  Initial,
  RowActions,
  RowTitle,
  TableCell,
  TableRow,
  openRowOnClick,
} from "@/components/ui";
import { useT } from "@/i18n/react";
import { driverFullName } from "@/features/delivery/model";
import { DriverStatusBadge } from "@/features/delivery/components/DriverStatusBadge";
import type { Driver } from "@/features/delivery/types";

function DriverActionsMenu({
  driver,
  activeCount,
  canManage,
  canAssign,
  onView,
  onAssign,
  onCompensations,
  onEdit,
  onDelete,
}: {
  driver: Driver;
  activeCount: number;
  canManage: boolean;
  canAssign: boolean;
  onView: (driver: Driver) => void;
  onAssign: (driver: Driver) => void;
  onCompensations: (driver: Driver) => void;
  onEdit: (driver: Driver) => void;
  onDelete: (driver: Driver) => void;
}) {
  const t = useT("delivery");
  const common = useT("common");
  const hasOrders = activeCount > 0;
  return (
    <DropdownMenu
      trigger={<MoreHorizontal size={16} />}
      triggerLabel={common("table.actions")}
    >
      <DropdownItem onClick={() => onView(driver)}>
        <Eye size={15} />
        {t("actions.view")}
      </DropdownItem>
      {canAssign && driver.status !== "inactive" && (
        <DropdownItem onClick={() => onAssign(driver)}>
          <Package size={15} />
          {t("actions.assign_orders")}
        </DropdownItem>
      )}
      <DropdownItem onClick={() => onCompensations(driver)}>
        <DollarSign size={15} />
        {t("actions.compensations")}
      </DropdownItem>
      {canManage && (
        <DropdownItem onClick={() => onEdit(driver)}>
          <Pencil size={15} />
          {t("actions.edit")}
        </DropdownItem>
      )}
      {canManage && (
        <DropdownItem
          onClick={() => onDelete(driver)}
          disabled={hasOrders}
          danger
        >
          <Trash2 size={15} />
          {t("actions.delete")}
        </DropdownItem>
      )}
    </DropdownMenu>
  );
}

interface DriverRowProps {
  driver: Driver;
  activeCount: number;
  canManage: boolean;
  canAssign: boolean;
  onView: (driver: Driver) => void;
  onAssign: (driver: Driver) => void;
  onCompensations: (driver: Driver) => void;
  onEdit: (driver: Driver) => void;
  onDelete: (driver: Driver) => void;
}

function driverHref(driver: Driver) {
  return `/delivery/drivers/${encodeURIComponent(driver.id)}`;
}

export function DriverDesktopRow({ driver, activeCount, ...menu }: DriverRowProps) {
  const t = useT("delivery");
  const name = driverFullName(driver);
  const wilayas = driver.compensationWilayaCount ?? 0;
  return (
    <TableRow onClick={openRowOnClick(driverHref(driver))} className="cursor-pointer">
      <TableCell className="max-w-64">
        <RowTitle href={driverHref(driver)} media={<Initial name={name} />}>
          {name}
        </RowTitle>
      </TableCell>
      <TableCell className="tabular-nums whitespace-nowrap text-muted-foreground">
        <span dir="ltr">{driver.phone}</span>
      </TableCell>
      <TableCell>
        <DriverStatusBadge status={driver.status} />
      </TableCell>
      <TableCell className="text-muted-foreground">
        {wilayas > 0 ? t("wilaya_count", { count: wilayas }) : <CellEmpty />}
      </TableCell>
      <TableCell numeric className={activeCount > 0 ? "" : "text-muted-foreground"}>
        {activeCount}
      </TableCell>
      <TableCell className="w-px">
        <RowActions>
          <DriverActionsMenu driver={driver} activeCount={activeCount} {...menu} />
        </RowActions>
      </TableCell>
    </TableRow>
  );
}

export function DriverMobileCard({ driver, activeCount, ...menu }: DriverRowProps) {
  const t = useT("delivery");
  const name = driverFullName(driver);
  return (
    <article
      onClick={openRowOnClick(driverHref(driver))}
      className="flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors active:bg-subtle"
    >
      <Initial name={name} className="size-9" />
      <div className="min-w-0 flex-1">
        <a href={driverHref(driver)} className="block truncate text-sm font-medium text-foreground">
          {name}
        </a>
        <p className="truncate text-xs text-muted-foreground">
          <span dir="ltr">{driver.phone}</span>
          {activeCount > 0 && <> · {t("active_count", { count: activeCount })}</>}
        </p>
      </div>
      <DriverStatusBadge status={driver.status} />
      <DriverActionsMenu driver={driver} activeCount={activeCount} {...menu} />
    </article>
  );
}
