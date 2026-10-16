import { RequireAuth } from "@/features/auth/components/RequireAuth";
import { DashboardChrome } from "@/components/layout/chrome";
import { TeamList } from "@/features/team/components/TeamList";

function Gated() {
  return (
    <DashboardChrome currentPath="/team">
      <TeamList />
    </DashboardChrome>
  );
}

export default function TeamPageApp() {
  return (
    <RequireAuth>
      <Gated />
    </RequireAuth>
  );
}
