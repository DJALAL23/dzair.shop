/**
 * Arabic (ar) - otp.
 */

import type { OtpStrings } from "../types/otp";

export const arOtp: OtpStrings = {
  otpTitle: "تأكيد رقم الهاتف",
  otpSubtitle: "أرسلنا رمزاً من 6 أرقام إلى واتساب",
  otpInputLabel: "رمز التحقق",
  otpInputPlaceholder: "••••••",
  otpVerifyBtn: "تأكيد الرمز",
  otpVerifying: "جارٍ التحقق...",
  otpResendIn: "إعادة الإرسال بعد",
  otpResend: "إعادة إرسال الرمز",
  otpChangePhone: "تغيير رقم الهاتف",
  otpErrorWrong: "الرمز غير صحيح — تحقق من واتساب وأعد المحاولة",
  otpErrorAttempts: "المحاولات المتبقية:",
  otpErrorExpired: "انتهت صلاحية الرمز — اطلب رمزاً جديداً",
  otpErrorRate: "طلبت رموزاً كثيرة — انتظر قليلاً ثم أعد المحاولة",
  otpErrorGeneric: "تعذر إرسال الرمز — أعد المحاولة",
  turnstileErrorFailed: "فشل التحقق الأمني — أعد إرسال الطلب",
  turnstileVerifying: "جارٍ التحقق الأمني — الرجاء الانتظار…",
};
