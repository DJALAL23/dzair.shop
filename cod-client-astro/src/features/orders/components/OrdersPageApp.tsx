import { canScope, RequireAuth, useIdentity } from "@/features/auth/components/RequireAuth";
import { DashboardPage } from "@/components/layout/page";
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
      <DashboardPage>
        <Alert tone="critical">{auth("no_access")}</Alert>
      </DashboardPage>
    );
  }
  return (
    <DashboardPage>
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
    </DashboardPage>
  );
}

export default function OrdersPageApp() {
  return <RequireAuth><Gated /></RequireAuth>;
}
