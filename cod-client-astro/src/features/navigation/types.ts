import type { MENU_RESOURCE_DESTINATIONS, MenuDestination, MenuDestinationType } from "../../../../cod-shared/navigation/menus";

export type { MenuDestination, MenuDestinationType };

export type MenuResourceType = (typeof MENU_RESOURCE_DESTINATIONS)[number];

/** `GET /api/menus` — one row of the list. */
export interface MenuSummary {
  id: string;
  handle: string;
  title: string;
  itemCount: number;
  updatedAt: string;
}

/** An item as the server holds it. */
export interface MenuItemNode {
  id: string;
  label: string;
  destination: MenuDestination;
  /** `missing`: deleted; `hidden`: shoppers cannot see it now. Either way the storefront leaves the item out. */
  destinationStatus: "ok" | "missing" | "hidden";
  destinationLabel: string | null;
  children: MenuItemNode[];
}

/** `GET /api/menus/{id}`. */
export interface MenuDetail {
  id: string;
  handle: string;
  title: string;
  updatedAt: string;
  items: MenuItemNode[];
}

/** `PUT /api/menus/{id}/items` — one item of the tree sent. */
export interface MenuItemInput {
  id?: string;
  label: string;
  destination: MenuDestination;
  children?: MenuItemInput[];
}

/** `GET /api/menus/destinations` — something an item can point at. */
export interface MenuDestinationOption {
  id: string;
  label: string;
  path: string;
  visible: boolean;
}
