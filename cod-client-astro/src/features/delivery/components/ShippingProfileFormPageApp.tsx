import { RequireAuth } from "@/features/auth/components/RequireAuth";
import { DashboardPage } from "@/components/layout/page";
import { ShippingProfileForm } from "@/features/delivery/components/ShippingProfileForm";

interface Props {
  profileId?: string;
}

function Gated({ profileId }: Props) {
  return (
    <DashboardPage>
      <ShippingProfileForm profileId={profileId} />
    </DashboardPage>
  );
}

export default function ShippingProfileFormPageApp({ profileId }: Props) {
  return (
    <RequireAuth>
      <Gated profileId={profileId} />
    </RequireAuth>
  );
}
