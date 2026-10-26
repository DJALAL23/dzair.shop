/** The Sendili App's setup. Absent (null) until it is set up. */
export interface SendiliSetup {
  fromEmail: string;
  fromName: string | null;
  enabled: boolean;
  apiKeyMasked: string;
  createdAt: string;
  updatedAt: string;
}

export interface SendiliSetupInput {
  apiKey?: string;
  fromEmail: string;
  fromName?: string | null;
  enabled?: boolean;
}

export interface SendiliKeyCheck {
  ok: boolean;
  reason?: string;
  message?: string;
  domains?: string[];
  outOfCredits?: boolean;
}
