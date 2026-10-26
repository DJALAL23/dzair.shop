/** The Turnstile App's setup. Absent (null) until it is set up. */
export interface TurnstileSetup {
  siteKey: string;
  enabled: boolean;
  secretKeyMasked: string;
  createdAt: string;
  updatedAt: string;
}

export interface TurnstileSetupInput {
  siteKey?: string;
  secretKey?: string;
  enabled?: boolean;
}
