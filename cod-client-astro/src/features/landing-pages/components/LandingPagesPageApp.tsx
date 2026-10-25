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
import { LandingPagesList } from "@/features/landing-pages/components/LandingPagesList";

function Gated() {
  const t = useT("landing-pages");
  const identity = useIdentity();
  return (
    <DashboardPage>
      <PageHeader
        title={t("page_title")}
        subtitle={t("page_subtitle")}
        actions={
          canScope(identity, SCOPES.LANDING_PAGES_MANAGE) ? (
            <LinkButton href="/landing-pages/new">
              <Plus size={16} />
              {t("create_landing_page")}
            </LinkButton>
          ) : undefined
        }
      />
      <LandingPagesList />
    </DashboardPage>
  );
}

export default function LandingPagesPageApp() {
  return (
    <RequireAuth>
      <Gated />
    </RequireAuth>
  );
}
