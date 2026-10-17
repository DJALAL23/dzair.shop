import type { Dispatch, SetStateAction } from "react";
import { Button, FilterPill, ListToolbar, SearchInput } from "@/components/ui";
import { useT } from "@/i18n/react";
import type {
  OfferDiscountType,
  OfferStatus,
} from "@/features/offers/types";
import { OFFER_TYPES, type OfferFilters } from "@/features/offers/model";

const STATUS_OPTIONS: OfferStatus[] = ["active", "inactive"];
export const EMPTY_FILTERS: OfferFilters = {
  query: "",
  status: "all",
  type: "all",
};

interface OfferFiltersBarProps {
  filters: OfferFilters;
  setFilters: Dispatch<SetStateAction<OfferFilters>>;
  filteredCount: number;
  hasFilters: boolean;
}

export function OfferFiltersBar({
  filters,
  setFilters,
  filteredCount,
  hasFilters,
}: OfferFiltersBarProps) {
  const t = useT("offers");
  const common = useT("common");

  return (
    <ListToolbar count={t("count", { count: filteredCount })}>
      <SearchInput
        value={filters.query}
        onChange={(query) => setFilters((current) => ({ ...current, query }))}
        placeholder={t("search_placeholder")}
        className="basis-full sm:basis-72"
      />
      <FilterPill
        label={t("table.status")}
        value={filters.status}
        onChange={(status) => setFilters((current) => ({ ...current, status: status as OfferStatus | "all" }))}
      >
        <option value="all">{t("table.status")}</option>
        {STATUS_OPTIONS.map((status) => (
          <option key={status} value={status}>
            {t(`status.${status}`)}
          </option>
        ))}
      </FilterPill>
      <FilterPill
        label={t("table.type")}
        value={filters.type}
        onChange={(type) => setFilters((current) => ({ ...current, type: type as OfferDiscountType | "all" }))}
      >
        <option value="all">{t("table.type")}</option>
        {OFFER_TYPES.map((type) => (
          <option key={type} value={type}>
            {t(`discount_type.${type}`)}
          </option>
        ))}
      </FilterPill>
      {hasFilters && (
        <Button type="button" variant="ghost" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
          {common("clear_filters")}
        </Button>
      )}
    </ListToolbar>
  );
}
