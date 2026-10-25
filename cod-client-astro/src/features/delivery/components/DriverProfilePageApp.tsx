import { RequireAuth } from "@/features/auth/components/RequireAuth";
import { DashboardPage } from "@/components/layout/page";
import { DriverDetail } from "@/features/delivery/components/DriverDetail";

function Gated({ driverId }: { driverId: string }) {
  return (
    <DashboardPage>
      <DriverDetail driverId={driverId} />
    </DashboardPage>
  );
}

export default function DriverProfilePageApp({
  driverId,
}: {
  driverId: string;
}) {
  return (
    <RequireAuth>
      <Gated driverId={driverId} />
    </RequireAuth>
  );
}
