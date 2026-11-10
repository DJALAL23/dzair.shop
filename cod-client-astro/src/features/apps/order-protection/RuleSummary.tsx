import { useLocale, useT } from "@/i18n/react";
import { valueInputOf, wilayaOptions } from "@/features/apps/order-protection/model";
import { countryName, eitherOf } from "@/features/apps/order-protection/words";
import type { Condition, ListValue, WindowValue } from "../../../../../cod-shared/order-screening/conditions";

/** One Condition in words: what it checks and against what. */
export function ConditionSummary({ condition }: { condition: Condition }) {
  const t = useT("apps");
  const locale = useLocale();
  const label = t(`order_protection.conditions.${condition.key}`);
  const op = t(`order_protection.operators.${condition.op}`);
  const list = () => condition.value as ListValue;

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
        return eitherOf(list().map(String), locale);
      case "wilaya": {
        const options = wilayaOptions(locale);
        return eitherOf(list().map((id) => options.find((option) => option.id === String(id))?.label ?? String(id)), locale);
      }
      case "country":
        return eitherOf(list().map((code) => countryName(String(code), locale)), locale);
      case "product":
        return t("order_protection.editor.products_count", { count: list().length });
      case "options":
        return eitherOf(list().map((value) => t(`order_protection.options.${condition.key}.${value}`)), locale);
    }
  }

  return (
    <span>
      <span className="font-medium text-foreground">{label}</span> {op} <bdi>{detail()}</bdi>
    </span>
  );
}
