import { RequireAuth } from "@/features/auth/components/RequireAuth";
import { DashboardPage } from "@/components/layout/page";
import { DriverCompensationsDetail } from "@/features/delivery/components/DriverCompensationsDetail";

function Gated({ driverId }: { driverId: string }) {
  return (
    <DashboardPage>
      <DriverCompensationsDetail driverId={driverId} />
    </DashboardPage>
  );
}

export default function DriverCompensationsPageApp({
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
