/** The DZVerify App's setup. Absent (null) until it is set up. */
export interface DZVerifySetup {
  language: "en" | "fr" | "ar";
  enabled: boolean;
  apiKeyMasked: string;
  createdAt: string;
  updatedAt: string;
}

export interface DZVerifySetupInput {
  apiKey?: string;
  language?: "en" | "fr" | "ar";
  enabled?: boolean;
}

export interface DZVerifyKeyCheck {
  ok: boolean;
  reason?: string;
  message?: string;
  balanceDa?: number;
  otpEstimate?: number;
  plan?: string;
  outOfCredits?: boolean;
}
