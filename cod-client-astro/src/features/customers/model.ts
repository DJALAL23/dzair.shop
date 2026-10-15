import type { Customer, CustomerOrderSummary } from "./types";

export interface CustomerFilters {
  query: string;
  wilaya: string;
}

export type CustomerSortKey = "name" | "totalOrders" | "totalSpent" | "createdAt";

export type CustomerRoute =
  | { kind: "list" }
  | { kind: "new" }
  | { kind: "detail"; id: string }
  | { kind: "edit"; id: string }
  | { kind: "unknown" };

export function filterCustomers(customers: Customer[], filters: CustomerFilters) {
  const query = filters.query.trim().toLocaleLowerCase();
  return customers.filter((customer) => {
    if (query && `${customer.name} ${customer.phone} ${customer.phone2 ?? ""} ${customer.wilaya} ${customer.commune ?? ""} ${customer.address ?? ""}`.toLocaleLowerCase().indexOf(query) === -1) {
      return false;
    }
    return filters.wilaya === "all" || String(customer.wilayaId ?? "") === filters.wilaya;
  });
}

export function sortCustomers(customers: Customer[], key: CustomerSortKey, direction: "asc" | "desc") {
  return [...customers].sort((left, right) => {
    const leftValue = left[key];
    const rightValue = right[key];
    const comparison = typeof leftValue === "number" && typeof rightValue === "number"
      ? leftValue - rightValue
      : String(leftValue ?? "").localeCompare(String(rightValue ?? ""), undefined, { numeric: true, sensitivity: "base" });
    return direction === "asc" ? comparison : -comparison;
  });
}

export function paginateCustomers(customers: Customer[], page: number, pageSize: number) {
  const safePage = Math.max(1, page);
  const safePageSize = Math.max(1, pageSize);
  return customers.slice((safePage - 1) * safePageSize, safePage * safePageSize);
}

/**
 * Of the parcels that reached this customer, the share they refused (on its
 * way back, or back) — what a merchant weighs before shipping to them again.
 * Orders not yet delivered or refused do not count either way.
 */
export function calculateReturnRate(orders: Pick<CustomerOrderSummary, "stage">[]) {
  const refused = orders.filter((order) => order.stage === "returning" || order.stage === "returned").length;
  const reached = refused + orders.filter((order) => order.stage === "delivered").length;
  return reached === 0 ? 0 : Math.round((refused / reached) * 100);
}

export function customerCanDelete(customer: Pick<Customer, "totalOrders">) {
  return customer.totalOrders === 0;
}

export function parseCustomerRoute(pathname: string): CustomerRoute {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/customers") return { kind: "list" };
  if (path === "/customers/new") return { kind: "new" };
  const match = path.match(/^\/customers\/([^/]+)(\/edit)?$/);
  if (!match) return { kind: "unknown" };
  try {
    const id = decodeURIComponent(match[1]);
    if (!id || id === "new") return { kind: "unknown" };
    return match[2] ? { kind: "edit", id } : { kind: "detail", id };
  } catch {
    return { kind: "unknown" };
  }
}

export function customerErrorMessage(cause: unknown, t: (key: string) => string) {
  const code = cause && typeof cause === "object" && "code" in cause ? String(cause.code) : "";
  if (code === "DUPLICATE_PHONE") return t("error_duplicate_phone");
  if (code === "CUSTOMER_HAS_ORDERS") return t("error_cannot_delete_with_orders");
  if (code === "CUSTOMER_NOT_FOUND") return t("error_not_found");
  return t("error_generic");
}
