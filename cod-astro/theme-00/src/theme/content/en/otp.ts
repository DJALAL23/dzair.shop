/**
 * English (en) - otp.
 */

import type { OtpStrings } from "../types/otp";

export const enOtp: OtpStrings = {
  otpTitle: "Verify your phone",
  otpSubtitle: "We sent a 6-digit code to your WhatsApp",
  otpInputLabel: "Verification code",
  otpInputPlaceholder: "••••••",
  otpVerifyBtn: "Confirm code",
  otpVerifying: "Verifying...",
  otpResendIn: "Resend in",
  otpResend: "Resend code",
  otpChangePhone: "Change phone number",
  otpErrorWrong: "Wrong code — check WhatsApp and try again",
  otpErrorAttempts: "Attempts left:",
  otpErrorExpired: "This code has expired — request a new one",
  otpErrorRate: "Too many requests — please wait a moment and try again",
  otpErrorGeneric: "Could not send the code — please try again",
  turnstileErrorFailed: "Security verification failed — please retry your order",
  turnstileVerifying: "Checking security — please wait…",
};
