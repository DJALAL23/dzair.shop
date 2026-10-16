import { canScope, RequireAuth, useIdentity } from "@/features/auth/components/RequireAuth";
import { DashboardChrome } from "@/components/layout/chrome";
import { OrdersList } from "@/features/orders/components/OrdersList";
import { useT } from "@/i18n/react";
import { Plus } from "lucide-react";
import { Alert, LinkButton, PageHeader } from "@/components/ui";

function Gated() {
  const t = useT("orders");
  const auth = useT("auth");
  const identity = useIdentity();
  if (!canScope(identity, "orders:read")) {
    return (
      <DashboardChrome currentPath="/orders">
        <Alert tone="critical">{auth("no_access")}</Alert>
      </DashboardChrome>
    );
  }
  return (
    <DashboardChrome currentPath="/orders">
      <PageHeader
        title={t("page_title")}
        actions={canScope(identity, "orders:create") && (
          <LinkButton href="/orders/new">
            <Plus size={15} aria-hidden="true" />
            {t("new_order_button")}
          </LinkButton>
        )}
      />
      <OrdersList />
    </DashboardChrome>
  );
}

export default function OrdersPageApp() {
  return <RequireAuth><Gated /></RequireAuth>;
}
