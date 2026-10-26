import { appRequest } from "../api";
import type { StoreTrackingSwitches } from "../../../../../cod-shared/queries/tracking-config";
import type { MetaSetup, MetaSetupInput } from "./types";

export const getMetaApp = () => appRequest<MetaSetup | null>("meta", "", "GET");

export const saveMetaApp = (input: MetaSetupInput) => appRequest<MetaSetup>("meta", "", "PUT", input);

/** The Meta App's switches a landing page's own pixel depends on: null when it is not set up, or for a member who may not see it (nothing is asked then). */
export async function metaSwitches(mayReadMeta: boolean): Promise<StoreTrackingSwitches | null> {
  if (!mayReadMeta) return null;
  const setup = await getMetaApp();
  return setup ? { enabled: setup.enabled, perPageTrackingEnabled: setup.perPageTrackingEnabled } : null;
}
