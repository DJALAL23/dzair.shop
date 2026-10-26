/** The Meta App's setup. Absent until it is set up. */
export interface MetaSetup {
  id: string;
  storeId: string;
  pixelId: string;
  adAccountName: string | null;
  accessTokenMasked: string;
  testEventCode: string | null;
  conversionEvent: "Purchase" | "Purchase_Confirmed" | "Purchase_Delivered" | "Lead";
  testMode: boolean;
  enabled: boolean;
  /** Master switch for per-landing-page pixels — off means every page uses this one. */
  perPageTrackingEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MetaSetupInput {
  pixelId: string;
  adAccountName?: string | null;
  accessToken?: string;
  testEventCode?: string | null;
  conversionEvent: "Purchase" | "Purchase_Confirmed" | "Purchase_Delivered" | "Lead";
  testMode?: boolean;
  enabled?: boolean;
  /** Omitted keeps the stored value — an unrelated edit must not reset it. */
  perPageTrackingEnabled?: boolean;
}
