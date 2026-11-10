import { Mail, MapPin, Phone, UserRound } from "lucide-react";
import { Card } from "@/components/ui";
import { useLocale, useT } from "@/i18n/react";
import { communeLabel, wilayaLabel } from "@/lib/places";
import type { OrderDetail } from "@/features/orders/types";

interface OrderCustomerCardProps {
  order: Pick<
    OrderDetail,
    "customerName" | "phone" | "wilaya" | "commune" | "address" | "customerEmail"
  > &
    Partial<Pick<OrderDetail, "wilayaId" | "communeId">
  >;
}

export function OrderCustomerCard({ order }: OrderCustomerCardProps) {
  const t = useT("orders");
  const locale = useLocale();
  const wilaya = wilayaLabel(order.wilayaId, order.wilaya, locale);
  const commune = communeLabel(order.communeId, order.commune, locale);

  return (
    <Card title={t("detail.customer_info")}>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="flex items-start gap-3">
          <UserRound size={18} className="mt-0.5 text-muted-foreground" />
          <div>
            <p className="text-xs text-muted-foreground">
              {t("detail.name")}
            </p>
            <p className="mt-1 text-sm font-medium">
              {order.customerName}
            </p>
            <a
              href={`tel:${order.phone}`}
              className="mt-1 inline-flex items-center gap-1 text-sm text-link"
              dir="ltr"
            >
              <Phone size={13} />
              {order.phone}
            </a>
            {/* Only when the shopper gave one — an empty row would suggest the
                merchant collects an email when they may not have asked. */}
            {order.customerEmail && (
              <a
                href={`mailto:${order.customerEmail}`}
                className="mt-1 flex items-center gap-1 text-sm text-link"
                dir="ltr"
              >
                <Mail size={13} />
                {order.customerEmail}
              </a>
            )}
          </div>
        </div>
        <div className="flex items-start gap-3">
          <MapPin size={18} className="mt-0.5 text-muted-foreground" />
          <div>
            <p className="text-xs text-muted-foreground">
              {t("detail.destination")}
            </p>
            <p className="mt-1 text-sm font-medium">
              {wilaya ?? "-"}
            </p>
            {/* A wilaya's capital shares its name (Adrar, Adrar): say it once. */}
            {commune && commune !== wilaya && (
              <p className="text-sm text-muted-foreground">{commune}</p>
            )}
            <p className="mt-1 text-sm text-foreground">
              {order.address ?? "-"}
            </p>
          </div>
        </div>
      </div>
    </Card>
  );
}
