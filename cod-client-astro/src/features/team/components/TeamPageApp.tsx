import { RequireAuth } from "@/features/auth/components/RequireAuth";
import { DashboardPage } from "@/components/layout/page";
import { TeamList } from "@/features/team/components/TeamList";

function Gated() {
  return (
    <DashboardPage>
      <TeamList />
    </DashboardPage>
  );
}

export default function TeamPageApp() {
  return (
    <RequireAuth>
      <Gated />
    </RequireAuth>
  );
}
