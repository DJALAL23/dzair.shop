import { useState } from "react";
import { Package } from "lucide-react";
import { Button, Card, Input } from "@/components/ui";
import { useT } from "@/i18n/react";
import { notify } from "@/lib/notify";
import { setLineReturn } from "@/features/orders/api";
import { formatMoney, orderTotal } from "@/features/orders/model";
import type { OrderDetail, OrderProduct } from "@/features/orders/types";
import type { Locale } from "@/i18n/config";

function RefusedUnits({ orderId, line, onChanged }: { orderId: string; line: OrderProduct; onChanged: () => void | Promise<void> }) {
  const t = useT("orders");
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(line.returnedQuantity));
  const [busy, setBusy] = useState(false);
  const quantity = Number(value);
  const valid = Number.isInteger(quantity) && quantity >= 0 && quantity <= line.quantity;

  async function save() {
    setBusy(true);
    try {
      await setLineReturn(orderId, line.id, quantity);
      notify.success(t("refused.saved", { count: quantity, product: line.productName }));
      setEditing(false);
      await onChanged();
    } catch (cause) {
      notify.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <button type="button" onClick={() => setEditing(true)} className="mt-1 text-xs font-semibold text-link underline-offset-4 hover:underline">
        {line.returnedQuantity > 0 ? t("refused.change") : t("refused.record")}
      </button>
    );
  }
  return (
    <div className="mt-2 flex items-center gap-2">
      <Input type="number" min="0" max={line.quantity} value={value} onChange={(event) => setValue(event.currentTarget.value)} aria-label={t("refused.units")} className="h-8 w-20" />
      <span className="text-xs text-muted-foreground">{t("refused.of", { count: line.quantity })}</span>
      <Button type="button" size="sm" disabled={!valid || busy} onClick={() => void save()}>
        {t("refused.save")}
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
        {t("ship.close")}
      </Button>
    </div>
  );
}

/** What the customer ordered — and, once delivered, what they kept back at the door. */
export function OrderProductsCard({
  order,
  locale,
  canRecordRefused,
  onChanged,
}: {
  order: Pick<OrderDetail, "id" | "products" | "price" | "deliveryFee">;
  locale: Locale;
  canRecordRefused: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const t = useT("orders");

  return (
    <Card title={t("form.products_section")}>
      <div className="divide-y divide-border">
        {order.products.map((product) => {
          const free = product.pricePerUnit === 0 && product.lineTotal === 0;
          return (
            <div key={product.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <Package size={17} className="mt-0.5 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{product.productName}</p>
                {product.variantLabel && <p className="text-xs text-muted-foreground">{product.variantLabel}</p>}
                <p className="mt-1 text-xs text-muted-foreground">
                  {product.quantity} × {free ? t("form.free") : formatMoney(product.pricePerUnit, locale)}
                </p>
                {product.returnedQuantity > 0 && (
                  <p className="mt-1 text-xs font-semibold text-[var(--tone-critical-text)]">{t("refused.count", { count: product.returnedQuantity })}</p>
                )}
                {canRecordRefused && <RefusedUnits orderId={order.id} line={product} onChanged={onChanged} />}
              </div>
              <span className={`text-sm tabular-nums ${free ? "text-success" : ""}`}>{free ? "-" : formatMoney(product.lineTotal, locale)}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
        <div className="flex justify-between text-muted-foreground">
          <span>{t("detail.subtotal")}</span>
          <span className="tabular-nums">{formatMoney(order.price, locale)}</span>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span>{t("detail.delivery_fee")}</span>
          <span className="tabular-nums">{formatMoney(order.deliveryFee, locale)}</span>
        </div>
        <div className="flex justify-between border-t border-border pt-3 font-semibold">
          <span>{t("detail.total_price")}</span>
          <span className="tabular-nums">{formatMoney(orderTotal(order), locale)}</span>
        </div>
      </div>
    </Card>
  );
}
