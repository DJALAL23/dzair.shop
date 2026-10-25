import { RequireAuth } from "@/features/auth/components/RequireAuth";
import { DashboardPage } from "@/components/layout/page";
import { TeamMemberDetail } from "@/features/team/components/TeamMemberDetail";

function Gated({ memberId }: { memberId: string }) {
  return (
    <DashboardPage>
      <TeamMemberDetail memberId={memberId} />
    </DashboardPage>
  );
}

export default function TeamMemberPageApp({ memberId }: { memberId: string }) {
  return (
    <RequireAuth>
      <Gated memberId={memberId} />
    </RequireAuth>
  );
}
