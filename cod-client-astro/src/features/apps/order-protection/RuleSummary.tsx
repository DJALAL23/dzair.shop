import { useLocale, useT } from "@/i18n/react";
import { valueInputOf, wilayaOptions } from "@/features/apps/order-protection/model";
import type { Condition, ListValue, WindowValue } from "../../../../../cod-shared/order-screening/conditions";

/** One Condition in words: what it checks and against what. */
export function ConditionSummary({ condition }: { condition: Condition }) {
  const t = useT("apps");
  const locale = useLocale();
  const label = t(`order_protection.conditions.${condition.key}`);
  const op = t(`order_protection.operators.${condition.op}`);

  function detail(): string {
    switch (valueInputOf(condition.key, condition.op)) {
      case "none":
        return "";
      case "number":
        return String(condition.value);
      case "window": {
        const value = condition.value as WindowValue;
        return `${value.count} · ${t(`order_protection.windows.${value.windowHours}`)}`;
      }
      case "text":
        return (condition.value as ListValue).join("، ");
      case "wilaya": {
        const options = wilayaOptions(locale);
        return (condition.value as ListValue).map((id) => options.find((option) => option.id === String(id))?.label ?? String(id)).join("، ");
      }
      case "product":
        return `(${(condition.value as ListValue).length})`;
      case "options":
        return (condition.value as ListValue).map((value) => t(`order_protection.options.${condition.key}.${value}`)).join("، ");
    }
  }

  return (
    <span>
      <span className="font-medium text-foreground">{label}</span> {op} <bdi>{detail()}</bdi>
    </span>
  );
}
