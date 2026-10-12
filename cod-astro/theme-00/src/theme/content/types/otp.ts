/**
 * Content pack types - otp (split from types.ts).
 *
 * Groups: otp.
 */

export type OtpStrings = {
  otpTitle: string;
  otpSubtitle: string;
  otpInputLabel: string;
  otpInputPlaceholder: string;
  otpVerifyBtn: string;
  otpVerifying: string;
  otpResendIn: string;
  otpResend: string;
  otpChangePhone: string;
  otpErrorWrong: string;
  otpErrorAttempts: string;
  otpErrorExpired: string;
  otpErrorRate: string;
  otpErrorGeneric: string;

  // ── Cloudflare Turnstile (checkout bot protection) ─────────────────────────
  turnstileErrorFailed: string;
  turnstileVerifying: string;
};
