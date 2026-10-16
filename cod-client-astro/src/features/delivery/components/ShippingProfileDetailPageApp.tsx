import { useEffect, useState } from "react";
import { DollarSign, Edit } from "lucide-react";
import {
  canScope,
  RequireAuth,
  useIdentity,
} from "@/features/auth/components/RequireAuth";
import { DashboardChrome } from "@/components/layout/chrome";
import { Alert, Badge, Card, CellEmpty, EmptyState, LinkButton, PageHeader, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui";
import { formatMoney } from "@/features/orders/model";
import { useLocale, useT } from "@/i18n/react";
import { SCOPES } from "../../../../../cod-shared/rbac/scopes";
import { getShippingProfile } from "@/features/delivery/api";
import type { ShippingProfileWithRules } from "@/features/delivery/types";

function Loading() {
  return (
    <div role="status" aria-busy="true" className="space-y-4">
      <div className="h-20 shimmer rounded-xl" />
      <div className="h-64 shimmer rounded-xl" />
    </div>
  );
}

function ShippingProfileDetail({ profileId }: { profileId: string }) {
  const t = useT("settings");
  const delivery = useT("delivery");
  const auth = useT("auth");
  const common = useT("common");
  const locale = useLocale();
  const identity = useIdentity();
  const [profile, setProfile] = useState<ShippingProfileWithRules | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);

  async function load() {
    setLoadError(null);
    try {
      setProfile(await getShippingProfile(profileId));
    } catch (cause) {
      setLoadError(cause);
    }
  }

  useEffect(() => {
    if (canScope(identity, SCOPES.DELIVERY_READ)) void load();
  }, [identity?.role, identity?.scopes.join(",")]);

  const canManage = canScope(identity, SCOPES.DELIVERY_MANAGE);
  if (!canScope(identity, SCOPES.DELIVERY_READ))
    return (
      <Alert role="alert" tone="critical">
        {auth("no_access")}
      </Alert>
    );
  if (loadError)
    return (
      <Alert role="alert" tone="critical">
        <div className="flex-1">
          <p className="font-semibold">{delivery("error_load")}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 text-xs font-semibold underline underline-offset-4"
          >
            {common("retry")}
          </button>
        </div>
      </Alert>
    );
  if (profile === null) return <Loading />;

  const sortedRules = [...profile.rules].sort(
    (left, right) => left.wilayaId - right.wilayaId,
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={profile.name}
        badges={profile.isDefault ? <Badge tone="success">{t("shipping.default_badge")}</Badge> : undefined}
        subtitle={`${t("shipping.wilaya_count", { count: profile.rules.length })}, ${t("shipping.product_count", { count: profile.productCount ?? 0 })}`}
        backHref="/delivery/shipping-profiles"
        backLabel={common("back")}
        actions={
          canManage ? (
            <LinkButton href={`/delivery/shipping-profiles/${encodeURIComponent(profile.id)}/edit`}>
              <Edit size={15} aria-hidden="true" />
              {t("shipping.edit_action")}
            </LinkButton>
          ) : undefined
        }
      />
      {profile.notes && (
        <Card title={t("shipping.notes_label")}>
          <p className="text-sm text-foreground">{profile.notes}</p>
        </Card>
      )}
      <Card flush title={t("shipping.pricing_matrix")}>
        {sortedRules.length === 0 ? (
          <EmptyState compact icon={<DollarSign />} title={t("shipping.no_rates_configured")} />
        ) : (
          <div className="overflow-x-auto border-t border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("shipping.wilaya")}</TableHead>
                  <TableHead numeric>{t("shipping.home_delivery")}</TableHead>
                  <TableHead numeric>{t("shipping.stop_desk")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRules.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell className="font-medium">{locale === "ar" ? rule.wilayaNameAr : rule.wilayaName}</TableCell>
                    <TableCell numeric>{rule.homeEnabled ? formatMoney(rule.homePrice, locale) : <CellEmpty />}</TableCell>
                    <TableCell numeric>{rule.stopDeskEnabled ? formatMoney(rule.stopDeskPrice, locale) : <CellEmpty />}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Gated({ profileId }: { profileId: string }) {
  return (
    <DashboardChrome
      currentPath={`/delivery/shipping-profiles/${profileId}`}
    >
      <ShippingProfileDetail profileId={profileId} />
    </DashboardChrome>
  );
}

export default function ShippingProfileDetailPageApp({
  profileId,
}: {
  profileId: string;
}) {
  return (
    <RequireAuth>
      <Gated profileId={profileId} />
    </RequireAuth>
  );
}
