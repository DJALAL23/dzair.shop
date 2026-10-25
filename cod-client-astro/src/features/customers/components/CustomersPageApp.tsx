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
import { CustomersList } from "@/features/customers/components/CustomersList";

function Gated() {
  const t = useT("customers");
  const identity = useIdentity();
  return (
    <DashboardPage>
      <PageHeader
        title={t("page_title")}
        actions={
          canScope(identity, SCOPES.CUSTOMERS_CREATE) ? (
            <LinkButton href="/customers/new">
              <Plus size={16} />
              {t("new_customer")}
            </LinkButton>
          ) : undefined
        }
      />
      <CustomersList />
    </DashboardPage>
  );
}

export default function CustomersPageApp() {
  return (
    <RequireAuth>
      <Gated />
    </RequireAuth>
  );
}
