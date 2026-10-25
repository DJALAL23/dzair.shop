import {
  Building2,
  ClipboardList,
  FileText,
  ListTree,
  FolderOpen,
  Gift,
  Home,
  Inbox,
  Layers,
  Megaphone,
  MessageCircle,
  Package,
  PackageX,
  Settings,
  Shield,
  Sparkles,
  Star,
  Printer,
  Tag,
  Ticket,
  Truck,
  Users,
  Webhook,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { canScope, useIdentity } from "@/features/auth/components/RequireAuth";
import { useT } from "@/i18n/react";

export type NavLeaf = {
  kind: "leaf";
  label: string;
  icon: LucideIcon;
  href: string;
  scope?: string;
  badge?: string;
};

export type NavGroup = {
  kind: "group";
  id: string;
  label: string;
  icon: LucideIcon;
  href?: string;
  scope?: string;
  badge?: string;
  children: NavLeaf[];
};

export type NavNode = NavLeaf | NavGroup;

export type NavSection = {
  id: "main" | "store" | "admin";
  label?: string;
  items: NavNode[];
};

export function useNavSections(): NavSection[] {
  const identity = useIdentity();
  const tN = useT("navigation");
  const sections: NavSection[] = [
    {
      id: "main",
      items: [
        {
          kind: "leaf",
          href: "/dashboard",
          label: tN("sidebar.dashboard"),
          icon: Home,
          scope: "dashboard:view",
        },
        {
          kind: "group",
          id: "orders",
          label: tN("sidebar.orders"),
          icon: Inbox,
          href: "/orders",
          scope: "orders:read",
          children: [
            {
              kind: "leaf",
              href: "/orders/abandoned",
              label: tN("sidebar.orders_abandoned"),
              icon: PackageX,
              scope: "abandoned_orders:read",
            },
          ],
        },
        {
          kind: "group",
          id: "products",
          label: tN("sidebar.products"),
          icon: Tag,
          href: "/products",
          scope: "products:read",
          children: [
            {
              kind: "leaf",
              href: "/product-groups",
              label: tN("sidebar.categories"),
              icon: FolderOpen,
              scope: "product_groups:read",
            },
            {
              kind: "leaf",
              href: "/collections",
              label: tN("sidebar.collections"),
              icon: Layers,
              scope: "collections:read",
            },
            {
              kind: "leaf",
              href: "/products/stock",
              label: tN("sidebar.stock_management"),
              icon: Package,
              scope: "products:read",
            },
            {
              kind: "leaf",
              href: "/offers",
              label: tN("sidebar.offers"),
              icon: Gift,
              scope: "offers:read",
            },
            {
              kind: "leaf",
              href: "/coupons",
              label: tN("sidebar.coupons"),
              icon: Ticket,
              scope: "coupons:read",
            },
          ],
        },
        {
          kind: "group",
          id: "customers",
          label: tN("sidebar.customers"),
          icon: Users,
          href: "/customers",
          scope: "customers:read",
          children: [
            {
              kind: "leaf",
              href: "/customer-groups",
              label: tN("sidebar.customer_groups"),
              icon: Layers,
              scope: "customer_groups:read",
            },
            {
              kind: "leaf",
              href: "/customer-tags",
              label: tN("sidebar.customer_tags"),
              icon: Tag,
              scope: "customer_tags:read",
            },
          ],
        },
        {
          kind: "group",
          id: "delivery",
          label: tN("sidebar.delivery"),
          icon: Truck,
          href: "/delivery/companies",
          scope: "delivery:read",
          children: [
            {
              kind: "leaf",
              href: "/delivery/drivers",
              label: tN("sidebar.delivery_drivers"),
              icon: Building2,
              scope: "delivery:read",
            },
            {
              kind: "leaf",
              href: "/delivery/shipping-profiles",
              label: tN("sidebar.delivery_shipping"),
              icon: Package,
              scope: "delivery:read",
            },
            {
              kind: "leaf",
              href: "/delivery/labels",
              label: tN("sidebar.delivery_labels"),
              icon: Printer,
              scope: "delivery:read",
            },
          ],
        },
        {
          kind: "leaf",
          href: "/reviews",
          label: tN("sidebar.reviews"),
          icon: Star,
          scope: "reviews:read",
        },
      ],
    },
    {
      id: "store",
      label: tN("sidebar.online_store"),
      items: [
        {
          kind: "leaf",
          href: "/landing-pages",
          label: tN("sidebar.landing_pages"),
          icon: Megaphone,
          scope: "landing_pages:read",
        },
        {
          kind: "leaf",
          href: "/pages",
          label: tN("sidebar.store_pages"),
          icon: FileText,
          scope: "store_pages:read",
        },
        {
          kind: "leaf",
          href: "/navigation",
          label: tN("sidebar.navigation_menus"),
          icon: ListTree,
          scope: "navigation:read",
        },
        {
          kind: "leaf",
          href: "/checkout-form",
          label: tN("sidebar.checkout_form"),
          icon: ClipboardList,
          scope: "checkout_form:read",
        },
        {
          kind: "leaf",
          href: "/whatsapp",
          label: tN("sidebar.whatsapp"),
          icon: MessageCircle,
          scope: "whatsapp_widget:read",
        },
      ],
    },
    {
      id: "admin",
      items: [
        {
          kind: "leaf",
          href: "/integrations",
          label: tN("sidebar.integrations"),
          icon: Webhook,
          scope: "settings:integrations",
          badge: tN("badge.new"),
        },
        {
          kind: "leaf",
          href: "/team",
          label: tN("sidebar.team"),
          icon: Shield,
          scope: "admin",
        },
        {
          kind: "leaf",
          href: "/mcp",
          label: tN("sidebar.mcp"),
          icon: Sparkles,
          scope: "mcp:view",
        },
        {
          kind: "leaf",
          href: "/settings",
          label: tN("sidebar.settings"),
          icon: Settings,
          scope: "admin",
        },
      ],
    },
  ];

  return sections
    .map((section) => ({
      ...section,
      items: section.items
        .map((item) =>
          item.kind === "group"
            ? {
                ...item,
                children: item.children.filter((child) =>
                  child.scope === "admin"
                    ? identity?.role === "admin"
                    : !child.scope || canScope(identity, child.scope),
                ),
              }
            : item,
        )
        .filter((item) => {
          if (item.scope) {
            if (item.scope === "admin") {
              if (identity?.role !== "admin") return false;
            } else if (!canScope(identity, item.scope)) {
              return false;
            }
          }
          return true;
        }),
    }))
    .filter((section) => section.items.length > 0);
}

export function isCurrentPath(pathname: string, href: string): boolean {
  const currentPath = pathname.replace(/(.)\/+$/, "$1");
  if (href === "/") return currentPath === "/";
  if (href === "/orders") {
    return (
      currentPath === "/orders" ||
      (currentPath.startsWith("/orders/") &&
        currentPath !== "/orders/abandoned")
    );
  }
  if (href === "/products") {
    return (
      currentPath === "/products" ||
      (currentPath.startsWith("/products/") &&
        currentPath !== "/products/stock")
    );
  }
  return currentPath === href || currentPath.startsWith(`${href}/`);
}
