import { Plus } from "lucide-react";
import {
  canScope,
  RequireAuth,
  useIdentity,
} from "@/features/auth/components/RequireAuth";
import { DashboardPage } from "@/components/layout/page";
import { LinkButton, PageHeader } from "@/components/ui";
import { useT } from "@/i18n/react";
import { SCOPES } from "../../../../../cod-shared/rbac/scopes";
import { DriversList } from "@/features/delivery/components/DriversList";

function Gated() {
  const t = useT("delivery");
  const identity = useIdentity();
  return (
    <DashboardPage>
      <PageHeader
        title={t("tabs.drivers")}
        actions={
          canScope(identity, SCOPES.DELIVERY_MANAGE) ? (
            <LinkButton href="/delivery/drivers/new">
              <Plus size={16} />
              {t("add_driver")}
            </LinkButton>
          ) : undefined
        }
      />
      <DriversList />
    </DashboardPage>
  );
}

export default function DriversPageApp() {
  return (
    <RequireAuth>
      <Gated />
    </RequireAuth>
  );
}
