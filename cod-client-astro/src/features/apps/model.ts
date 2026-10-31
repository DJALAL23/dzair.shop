import type { BadgeTone } from "@/components/ui";
import { APP_CATALOG, APP_CATEGORIES, appOf } from "../../../../cod-shared/apps/catalog";
import type { AppCategory, AppKey, AppStatus, AppSummary } from "./types";

export const STATUS_TONES: Record<AppStatus, BadgeTone> = { not_set_up: "neutral", on: "success", off: "neutral", needs_attention: "warning" };

/** The Apps page's sections: each category that has an App to show, in catalog order. */
export function appsByCategory(apps: readonly AppSummary[]): { category: AppCategory; apps: AppSummary[] }[] {
  return APP_CATEGORIES.map((category) => ({ category, apps: apps.filter((app) => app.category === category) })).filter((section) => section.apps.length > 0);
}

/** What someone may do with an App: see it (read) and change it (manage). */
export function appAccess(key: AppKey, may: (scope: string) => boolean): { read: boolean; manage: boolean } {
  const { permissions } = appOf(key);
  return { read: may(permissions.read), manage: may(permissions.manage) };
}

/** Whether someone may see at least one App, and so the Apps page. */
export function mayReadAnApp(may: (scope: string) => boolean): boolean {
  return APP_CATALOG.some((app) => may(app.permissions.read));
}

/** Removing forgets what an App was set up with; there is nothing to forget before it is set up, nor for an App that is only turned off. */
export function canRemove(key: AppKey, status: AppStatus | null): boolean {
  return appOf(key).removable && status !== null && status !== "not_set_up";
}
