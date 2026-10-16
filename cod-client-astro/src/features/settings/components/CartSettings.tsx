import { useState } from "react";
import { ShoppingCart } from "lucide-react";
import { useT } from "@/i18n/react";
import { SwitchField } from "@/components/ui";
import type { StoreConfig } from "@/features/settings/types";
import { SettingsSection } from "@/features/settings/components/SettingsSection";

/**
 * The shopping cart opt-in.
 *
 * Off by default. Turning it on adds "Add to cart" alongside the existing
 * one-click order form — it never replaces it, because the direct form is what
 * converts for merchants selling a single product to ad traffic.
 */
export function CartSettings({
  storeConfig,
  onSave,
}: {
  storeConfig: StoreConfig;
  onSave: (payload: { cartEnabled?: boolean }) => Promise<void>;
}) {
  const t = useT("settings");
  const [cartEnabled, setCartEnabled] = useState(storeConfig.cartEnabled ?? false);

  return (
    <SettingsSection
      icon={ShoppingCart}
      title={t("store.cart_title")}
      subtitle={t("store.cart_subtitle")}
      onSave={async () => {
        await onSave({ cartEnabled });
      }}
    >
      <SwitchField
        label={t("store.cart_enabled_label")}
        help={
          <>
            <span className="block">{t("store.cart_enabled_hint")}</span>
            <span className="mt-1.5 block">{t("store.cart_enabled_note")}</span>
          </>
        }
        checked={cartEnabled}
        onChange={setCartEnabled}
      />
    </SettingsSection>
  );
}
