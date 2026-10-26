import type { AppCategory, AppKey } from "../../../../cod-shared/apps/catalog";
import type { AppStatus } from "../../../../cod-shared/queries/apps";

export type { AppCategory, AppKey, AppStatus };

/** One App as `GET /api/apps` lists it. */
export interface AppSummary {
  key: AppKey;
  category: AppCategory;
  status: AppStatus;
}

/** What every App's page body is given by the App Page around it. */
export interface AppBodyProps {
  canManage: boolean;
  /** Tell the App Page its setup changed, so its App Status is read again. */
  onSaved: () => void;
}
