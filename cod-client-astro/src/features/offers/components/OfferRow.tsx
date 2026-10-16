import { MoreHorizontal, Pencil, ToggleLeft, ToggleRight, Trash2 } from "lucide-react";
import {
  CellEmpty,
  DropdownItem,
  DropdownLink,
  DropdownMenu,
  RowActions,
  RowTitle,
  TableCell,
  TableRow,
  openRowOnClick,
} from "@/components/ui";
import { useLocale, useT } from "@/i18n/react";
import { offerRuleLabel, offerScheduleLabel } from "@/features/offers/model";
import { OfferStatusBadge } from "@/features/offers/components/OfferBadges";
import type { Offer } from "@/features/offers/types";

interface OfferRowProps {
  offer: Offer;
  canManage: boolean;
  onToggle: (offer: Offer) => void;
  onDelete: (offer: Offer) => void;
}

function offerHref(offer: Offer) {
  return `/offers/${encodeURIComponent(offer.id)}`;
}

function OfferActionsMenu({ offer, canManage, onToggle, onDelete }: OfferRowProps) {
  const t = useT("offers");
  const common = useT("common");
  return (
    <DropdownMenu trigger={<MoreHorizontal size={16} />} triggerLabel={`${common("table.actions")}: ${offer.name}`}>
      <DropdownLink href={offerHref(offer)}>
        <Pencil size={14} />
        {t("actions.edit")}
      </DropdownLink>
      {canManage && (
        <DropdownItem onClick={() => onToggle(offer)}>
          {offer.status === "active" ? <ToggleLeft size={14} /> : <ToggleRight size={14} />}
          {offer.status === "active" ? t("actions.deactivate") : t("actions.activate")}
        </DropdownItem>
      )}
      {canManage && (
        <DropdownItem danger onClick={() => onDelete(offer)}>
          <Trash2 size={14} />
          {t("actions.delete")}
        </DropdownItem>
      )}
    </DropdownMenu>
  );
}

export function OfferDesktopRow(props: OfferRowProps) {
  const { offer } = props;
  const t = useT("offers");
  const locale = useLocale();
  return (
    <TableRow onClick={openRowOnClick(offerHref(offer))} className="cursor-pointer">
      <TableCell className="max-w-64">
        <RowTitle href={offerHref(offer)}>{offer.name}</RowTitle>
      </TableCell>
      <TableCell className="max-w-52 truncate text-muted-foreground">
        {offer.triggerProduct?.name ?? <CellEmpty />}
      </TableCell>
      <TableCell className="max-w-52 truncate text-muted-foreground">
        {offerRuleLabel(offer, t)}
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {offerScheduleLabel(offer, locale, t) ?? <CellEmpty />}
      </TableCell>
      <TableCell>
        <OfferStatusBadge status={offer.status} />
      </TableCell>
      <TableCell className="w-px">
        <RowActions>
          <OfferActionsMenu {...props} />
        </RowActions>
      </TableCell>
    </TableRow>
  );
}

export function OfferMobileCard(props: OfferRowProps) {
  const { offer } = props;
  const t = useT("offers");
  return (
    <article
      onClick={openRowOnClick(offerHref(offer))}
      className="flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors active:bg-subtle"
    >
      <div className="min-w-0 flex-1">
        <a href={offerHref(offer)} className="block truncate text-sm font-medium text-foreground">
          {offer.name}
        </a>
        <p className="truncate text-xs text-muted-foreground">{offerRuleLabel(offer, t)}</p>
      </div>
      <OfferStatusBadge status={offer.status} />
      <OfferActionsMenu {...props} />
    </article>
  );
}
