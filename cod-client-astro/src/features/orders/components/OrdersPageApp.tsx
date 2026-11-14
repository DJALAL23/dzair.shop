import { canScope, RequireAuth, useIdentity } from "@/features/auth/components/RequireAuth";
import { DashboardPage } from "@/components/layout/page";
import { OrdersList } from "@/features/orders/components/OrdersList";
import { ReceivingToggle } from "@/features/confirmation/components/ReceivingToggle";
import { useT } from "@/i18n/react";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Alert, LinkButton, PageHeader } from "@/components/ui";

function Gated() {
  const t = useT("orders");
  const auth = useT("auth");
  const identity = useIdentity();
  const [version, setVersion] = useState(0);
  if (!canScope(identity, "orders:read") && !canScope(identity, "orders:read_assigned")) {
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
        actions={
          <div className="flex items-center gap-2">
            <ReceivingToggle onChanged={() => setVersion((v) => v + 1)} />
            {canScope(identity, "orders:create") && (
              <LinkButton href="/orders/new">
                <Plus size={15} aria-hidden="true" />
                {t("new_order_button")}
              </LinkButton>
            )}
          </div>
        }
      />
      <OrdersList key={version} />
    </DashboardPage>
  );
}

export default function OrdersPageApp() {
  return <RequireAuth><Gated /></RequireAuth>;
}
