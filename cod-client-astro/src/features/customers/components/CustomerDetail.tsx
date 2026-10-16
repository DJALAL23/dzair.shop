import { useEffect, useState } from "react";
import {
  Layers,
  Package,
  Pencil,
  Phone,
  Plus,
} from "lucide-react";
import {
  canScope,
  useIdentity,
} from "@/features/auth/components/RequireAuth";
import {
  Alert,
  Button,
  LinkButton,
  PageHeader,
  Tabs,
} from "@/components/ui";
import { useLocale, useT } from "@/i18n/react";
import { SCOPES } from "../../../../../cod-shared/rbac/scopes";
import {
  getCustomer,
  getCustomerGroups,
  getCustomerOrders,
  getCustomerTags,
  listCustomerGroups,
  listCustomerTags,
} from "@/features/customers/api";
import { customerErrorMessage } from "@/features/customers/model";
import type {
  Customer,
  CustomerGroup,
  CustomerGroupMembership,
  CustomerOrderSummary,
  CustomerTag,
  CustomerTagMembership,
} from "@/features/customers/types";
import { CustomerContactCard } from "@/features/customers/components/CustomerContactCard";
import { CustomerOrdersCard } from "@/features/customers/components/CustomerOrdersCard";
import { CustomerSegmentsCard } from "@/features/customers/components/CustomerSegmentsCard";
import { CustomerStatsSidebar } from "@/features/customers/components/CustomerStatsSidebar";

type Tab = "orders" | "segments";

function Loading() {
  return (
    <div role="status" aria-busy="true" className="space-y-4">
      <div className="h-32 shimmer rounded-xl" />
      <div className="h-64 shimmer rounded-xl" />
    </div>
  );
}

export function CustomerDetail({ customerId }: { customerId: string }) {
  const t = useT("customers");
  const common = useT("common");
  const auth = useT("auth");
  const locale = useLocale();
  const identity = useIdentity();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [orders, setOrders] = useState<CustomerOrderSummary[]>([]);
  const [groups, setGroups] = useState<CustomerGroupMembership[]>([]);
  const [tags, setTags] = useState<CustomerTagMembership[]>([]);
  const [allGroups, setAllGroups] = useState<CustomerGroup[]>([]);
  const [allTags, setAllTags] = useState<CustomerTag[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("orders");

  async function load() {
    setError(null);
    try {
      const readGroups = canScope(identity, SCOPES.CUSTOMER_GROUPS_READ);
      const readTags = canScope(identity, SCOPES.CUSTOMER_TAGS_READ);
      const [
        customerResult,
        ordersResult,
        groupsResult,
        tagsResult,
        allGroupsResult,
        allTagsResult,
      ] = await Promise.allSettled([
        getCustomer(customerId),
        getCustomerOrders(customerId),
        readGroups ? getCustomerGroups(customerId) : Promise.resolve([]),
        readTags ? getCustomerTags(customerId) : Promise.resolve([]),
        readGroups ? listCustomerGroups() : Promise.resolve([]),
        readTags ? listCustomerTags() : Promise.resolve([]),
      ]);
      if (customerResult.status === "rejected") throw customerResult.reason;
      setCustomer(customerResult.value);
      setOrders(ordersResult.status === "fulfilled" ? ordersResult.value : []);
      setGroups(groupsResult.status === "fulfilled" ? groupsResult.value : []);
      setTags(tagsResult.status === "fulfilled" ? tagsResult.value : []);
      setAllGroups(
        allGroupsResult.status === "fulfilled" ? allGroupsResult.value : [],
      );
      setAllTags(
        allTagsResult.status === "fulfilled" ? allTagsResult.value : [],
      );
      const auxiliaryFailure = [
        ordersResult,
        groupsResult,
        tagsResult,
        allGroupsResult,
        allTagsResult,
      ].find((result) => result.status === "rejected");
      if (auxiliaryFailure?.status === "rejected")
        setError(customerErrorMessage(auxiliaryFailure.reason, t));
    } catch (cause) {
      setError(customerErrorMessage(cause, t));
    }
  }

  useEffect(() => {
    if (canScope(identity, SCOPES.CUSTOMERS_READ)) void load();
  }, [customerId, identity?.role, identity?.scopes.join(",")]);

  if (!canScope(identity, SCOPES.CUSTOMERS_READ))
    return (
      <Alert role="alert" tone="critical">
        {auth("no_access")}
      </Alert>
    );

  if (error && !customer)
    return (
      <Alert role="alert" tone="critical">
        <span className="flex-1">{error}</span>
        <Button type="button" variant="ghost" onClick={() => void load()}>
          {common("retry")}
        </Button>
      </Alert>
    );

  if (!customer) return <Loading />;

  const segmentCount = groups.length + tags.length;
  const canEdit =
    canScope(identity, SCOPES.CUSTOMERS_READ) &&
    canScope(identity, SCOPES.CUSTOMERS_UPDATE);

  return (
    <div className="space-y-5 pb-20 lg:pb-0">
      <PageHeader
        title={customer.name}
        subtitle={
          <span className="inline-flex items-center gap-2" dir="ltr">
            <Phone size={14} />
            {customer.phone}
          </span>
        }
        backHref="/customers"
        backLabel={t("page_title")}
        actions={
          <div className="flex gap-2">
            {canEdit && (
              <LinkButton
                href={`/customers/${encodeURIComponent(customer.id)}/edit`}
                variant="secondary"
              >
                <Pencil size={16} />
                {t("actions.edit")}
              </LinkButton>
            )}
            {canScope(identity, SCOPES.ORDERS_CREATE) && (
              <LinkButton href="/orders/new">
                <Plus size={16} />
                {t("profile.new_order")}
              </LinkButton>
            )}
          </div>
        }
      />
      {error && (
        <Alert role="alert" tone="critical">
          <span>{error}</span>
        </Alert>
      )}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-5">
          <CustomerContactCard customer={customer} />
          <Tabs
            label={t("profile.order_history")}
            value={tab}
            onChange={setTab}
            items={[
              { key: "orders" as Tab, label: t("profile.order_history"), icon: Package },
              ...(canScope(identity, SCOPES.CUSTOMER_GROUPS_READ) || canScope(identity, SCOPES.CUSTOMER_TAGS_READ)
                ? [{ key: "segments" as Tab, label: t("segments.tab"), icon: Layers, count: segmentCount > 0 ? segmentCount : undefined }]
                : []),
            ]}
          />
          {tab === "orders" ? (
            <CustomerOrdersCard orders={orders} locale={locale} />
          ) : (
            <CustomerSegmentsCard
              customer={customer}
              groups={groups}
              tags={tags}
              allGroups={allGroups}
              allTags={allTags}
              reload={load}
            />
          )}
        </div>
        <CustomerStatsSidebar
          customer={customer}
          orders={orders}
          locale={locale}
        />
      </div>
    </div>
  );
}
