import { RequireAuth } from "@/features/auth/components/RequireAuth";
import { DashboardChrome } from "@/components/layout/chrome";
import { TeamMemberDetail } from "@/features/team/components/TeamMemberDetail";

function Gated({ memberId }: { memberId: string }) {
  return (
    <DashboardChrome currentPath={`/team/${memberId}`}>
      <TeamMemberDetail memberId={memberId} />
    </DashboardChrome>
  );
}

export default function TeamMemberPageApp({ memberId }: { memberId: string }) {
  return (
    <RequireAuth>
      <Gated memberId={memberId} />
    </RequireAuth>
  );
}
