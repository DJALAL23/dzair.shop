import { canScope, RequireAuth, useIdentity } from "@/features/auth/components/RequireAuth";
import { DashboardPage } from "@/components/layout/page";
import { Alert } from "@/components/ui";
import { useT } from "@/i18n/react";
import { Integrations } from "@/features/events/components/Integrations";

function Gated() {
  const auth = useT("auth");
  const identity = useIdentity();
  if (!canScope(identity, "settings:integrations")) {
    return (
      <DashboardPage>
        <Alert tone="critical">{auth("no_access")}</Alert>
      </DashboardPage>
    );
  }
  return (
    <DashboardPage>
      <Integrations />
    </DashboardPage>
  );
}

export default function IntegrationsPageApp() {
  return (
    <RequireAuth>
      <Gated />
    </RequireAuth>
  );
}
