/**
 * The two menus every store starts with, as Shopify's do: `main-menu` for the
 * header and `footer` — the handles a theme's `menu` settings default to. With
 * them a theme never invents links of its own: what the header shows is what
 * the merchant's Navigation screen shows, from the first day.
 *
 * `defaultMenusSql` is part of store setup (`storeDefaultsSql`, starter/).
 * A menu is created only when the store has no menu with its handle, and its
 * items only in the run that created it: re-running setup never touches a
 * menu the store has, nor brings back an item the merchant removed from it.
 */
import { STORE_LOCALES, type StoreLocale } from "../i18n/locales";
import { sourceDigest } from "../i18n/translations";
import type { MenuDestination } from "./menus";

type Localized = Record<StoreLocale, string>;

interface DefaultItem {
  key: string;
  label: Localized;
  destination: Extract<MenuDestination, { type: "home" | "catalog" }>;
}

interface DefaultMenu {
  handle: string;
  title: Localized;
  items: readonly DefaultItem[];
}

const HOME: DefaultItem = { key: "home", label: { ar: "الرئيسية", fr: "Accueil", en: "Home" }, destination: { type: "home" } };
const CATALOG: DefaultItem = { key: "catalog", label: { ar: "كل المنتجات", fr: "Tous les produits", en: "All products" }, destination: { type: "catalog" } };

export const DEFAULT_MENUS: readonly DefaultMenu[] = [
  { handle: "main-menu", title: { ar: "القائمة الرئيسية", fr: "Menu principal", en: "Main menu" }, items: [HOME, CATALOG] },
  { handle: "footer", title: { ar: "تذييل الصفحة", fr: "Pied de page", en: "Footer" }, items: [HOME, CATALOG] },
];

const q = (value: string) => `'${value.replace(/'/g, "''")}'`;

/**
 * The statements that give a store its default menus: titles and labels in
 * its primary language, a translation for every other language, so one the
 * merchant adds later finds them. `now` marks this run: items and
 * translations are written only under a menu this run created, and a retry
 * of the same run completes what it left.
 */
export async function defaultMenusSql(store: { id: string; lang: StoreLocale }, now: string): Promise<string[]> {
  const others = STORE_LOCALES.filter((locale) => locale !== store.lang);
  const statements: string[] = [];
  for (const menu of DEFAULT_MENUS) {
    const menuId = `${store.id}:menu:${menu.handle}`;
    const createdNow = `(SELECT created_at FROM store_menus WHERE id = ${q(menuId)}) = ${q(now)}`;
    statements.push(
      `INSERT OR IGNORE INTO store_menus (id, store_id, handle, title, created_at, updated_at) VALUES (${q(menuId)}, ${q(store.id)}, ${q(menu.handle)}, ${q(menu.title[store.lang])}, ${q(now)}, ${q(now)})`,
    );
    for (const [position, item] of menu.items.entries()) {
      const itemId = `${menuId}:${item.key}`;
      const source = item.label[store.lang];
      statements.push(
        `INSERT OR IGNORE INTO store_menu_items (id, menu_id, parent_id, position, label, destination_type, destination_ref, url, created_at, updated_at) SELECT ${q(itemId)}, ${q(menuId)}, NULL, ${position}, ${q(source)}, ${q(item.destination.type)}, NULL, NULL, ${q(now)}, ${q(now)} WHERE ${createdNow}`,
      );
      const digest = await sourceDigest(source);
      for (const locale of others) {
        statements.push(
          `INSERT OR IGNORE INTO translations (resource_type, resource_id, locale, key, value, source_digest, updated_at) SELECT 'menuItem', ${q(itemId)}, ${q(locale)}, 'label', ${q(item.label[locale])}, ${q(digest)}, ${q(now)} WHERE ${createdNow}`,
        );
      }
    }
  }
  return statements;
}
