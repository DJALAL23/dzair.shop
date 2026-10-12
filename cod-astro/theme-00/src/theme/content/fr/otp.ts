/**
 * French (fr) - otp.
 */

import type { OtpStrings } from "../types/otp";

export const frOtp: OtpStrings = {
  otpTitle: "Vérifiez votre téléphone",
  otpSubtitle: "Nous avons envoyé un code à 6 chiffres sur votre WhatsApp",
  otpInputLabel: "Code de vérification",
  otpInputPlaceholder: "••••••",
  otpVerifyBtn: "Confirmer le code",
  otpVerifying: "Vérification...",
  otpResendIn: "Renvoyer dans",
  otpResend: "Renvoyer le code",
  otpChangePhone: "Changer le numéro",
  otpErrorWrong: "Code incorrect — vérifiez WhatsApp et réessayez",
  otpErrorAttempts: "Tentatives restantes :",
  otpErrorExpired: "Ce code a expiré — demandez-en un nouveau",
  otpErrorRate: "Trop de demandes — patientez un instant puis réessayez",
  otpErrorGeneric: "Impossible d'envoyer le code — réessayez",
  turnstileErrorFailed: "La vérification de sécurité a échoué — réessayez",
  turnstileVerifying: "Vérification de sécurité en cours — veuillez patienter…",
};
