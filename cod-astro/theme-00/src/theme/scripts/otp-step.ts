/**
 * Checkout WhatsApp OTP step (S9) — thin binding over the SDK's OTP machine.
 *
 * Send → verify → token/bypass, the 6-digit rule, the resend cooldown (60s, or
 * the server's rate-limit window), the attempt count and terminal expiry are
 * all `createOtpMachine`'s transitions. What stays here is the theme's half:
 * the elements, the content-pack copy, focus, and the gate that lets the
 * native form POST through once the phone is verified — or once the provider
 * failed open (the machine's "bypassed" state). Either way the token lands in
 * the hidden `#otp-token-input`, so the server still sees an attested phone.
 *
 * The transport is a thin same-origin fetch over `/api/otp/*` (the SDK proxy
 * factory already forwards `code`/`windowSeconds`/`attemptsRemaining`/
 * `terminal`, which is what the machine reads).
 *
 * No-JS reality: the form POSTs directly and the server's
 * OTP_VERIFICATION_REQUIRED error renders as the form's notice.
 */
import { onEachPage } from "@wocart/theme/lifecycle";
import {
  STOREFRONT_API_PATHS,
  STOREFRONT_OPERATIONS,
  createOtpMachine,
  createOtpTransport,
  mapOtpResponse,
  otpTransportFailure,
  type OtpSendResult,
  type OtpState,
  type OtpTransportResult,
  type OtpVerifyResult,
} from "@wocart/storefront";

// The routes are the SDK's own: their client checked each answer on the
// server, so the browser reads it without a schema — and without Zod.
async function postOtp<T>(
  path: string,
  body: Record<string, string>,
  operation: string,
  fallbackError: string,
): Promise<OtpTransportResult<T>> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return await mapOtpResponse<T>(response, { operation, fallbackError });
  } catch (error) {
    return otpTransportFailure(error, operation, fallbackError);
  }
}

const transport = createOtpTransport({
  send: (phone) =>
    postOtp<OtpSendResult>(STOREFRONT_API_PATHS.otpSend, { phone }, STOREFRONT_OPERATIONS.ordersOtpSend, "OTP send failed"),
  verify: (phone, requestId, code) =>
    postOtp<OtpVerifyResult>(STOREFRONT_API_PATHS.otpVerify, { phone, requestId, code }, STOREFRONT_OPERATIONS.ordersOtpVerify, "OTP verification failed"),
});

export function initOtpStep(): () => void {
  const form = document.querySelector<HTMLFormElement>("form[method='POST']");
  const step = document.getElementById("otp-step");
  const phoneInput = document.querySelector<HTMLInputElement>("input[name='phone']");
  const codeInput = document.getElementById("otp-code-input") as HTMLInputElement | null;
  const verifyBtn = document.getElementById("otp-verify-btn") as HTMLButtonElement | null;
  const errorEl = document.getElementById("otp-error") as HTMLElement | null;
  const resendBtn = document.getElementById("otp-resend-btn") as HTMLButtonElement | null;
  const resendLabel = document.getElementById("otp-resend-label") as HTMLElement | null;
  const changePhoneBtn = document.getElementById("otp-change-phone") as HTMLButtonElement | null;
  const tokenInput = document.getElementById("otp-token-input") as HTMLInputElement | null;
  const submitBtn = document.getElementById("submit-btn") as HTMLButtonElement | null;
  // #otp-step only renders when the store enables verification — its absence
  // means the feature is off and the native submit flow stays untouched.
  if (!form || !step || !phoneInput || !codeInput || !verifyBtn || !tokenInput) return () => {};

  const strings = JSON.parse(step.dataset.strings ?? "{}") as Record<string, string>;
  // Copy comes from the markup (`data-strings`, rendered from the content
  // pack). A missing key degrades to an empty string — never to an English
  // literal in a store that may be running Arabic or French (Theme Zero S6).
  const t = (key: string): string => strings[key] ?? "";

  const machine = createOtpMachine({ transport, initialPhone: phoneInput.value });

  /** One native POST per page: the resolved state must not submit twice. */
  let submitted = false;

  /**
   * The machine speaks codes; the shopper reads content-pack copy. The two
   * silences are deliberate: "not 6 digits yet" and "no request in flight"
   * were silent before the machine existed, and a banner for them is noise.
   */
  function messageFor(state: OtpState): string | null {
    if (state.status !== "error" && state.status !== "code_sent") return null;
    if (state.isTerminal) return t("otpErrorExpired");
    if (state.attemptsRemaining != null) {
      // The copy already ends with its colon.
      return `${t("otpErrorWrong")} (${t("otpErrorAttempts")} ${state.attemptsRemaining})`;
    }
    if (state.errorCode === "OTP_RATE_LIMITED") {
      // The cooldown is in seconds, the same unit as the resend countdown.
      return `${t("otpErrorRate")} (${state.cooldownRemaining}s)`;
    }
    if (state.errorCode === "INVALID_FORMAT" || state.errorCode === "NO_REQUEST") return null;
    if (state.errorCode === "NETWORK_ERROR") {
      return t("otpErrorGeneric");
    }
    // A sent code carries no error. Only a failed request gets the generic line.
    if (state.status === "code_sent" && state.error == null) return null;
    return state.error ?? t("otpErrorGeneric");
  }

  function setStepVisible(visible: boolean): void {
    const wasHidden = step!.classList.contains("hidden");
    step!.classList.toggle("hidden", !visible);
    if (visible && wasHidden) {
      codeInput!.value = "";
      codeInput!.focus();
    }
  }

  function render(state: OtpState): void {
    if (errorEl) {
      const message = messageFor(state);
      errorEl.textContent = message ?? "";
      errorEl.classList.toggle("hidden", message == null);
    }

    const resolved = state.status === "verified" || state.status === "bypassed";
    setStepVisible(state.status !== "idle" && !resolved);

    if (resendBtn) resendBtn.disabled = state.cooldownRemaining > 0;
    if (resendLabel) {
      resendLabel.textContent =
        state.cooldownRemaining > 0
          ? `${t("otpResendIn")} ${state.cooldownRemaining}`
          : t("otpResend");
    }

    if (verifyBtn) {
      const busy = state.status === "sending" || state.status === "verifying";
      verifyBtn.disabled = busy;
      verifyBtn.textContent =
        state.status === "verifying" ? t("otpVerifying") : t("otpVerifyBtn");
    }

    if (state.status === "idle") {
      tokenInput!.value = "";
    } else if (state.otpToken ?? state.bypassToken) {
      tokenInput!.value = state.otpToken ?? state.bypassToken ?? "";
    }

    if (state.attemptsRemaining != null || state.isTerminal) {
      codeInput!.value = "";
      codeInput!.focus();
    }

    if (resolved && !submitted) {
      submitted = true;
      form!.requestSubmit();
    }
  }

  machine.subscribe(render);

  // Phone edited after verification → the token no longer matches; the machine
  // resets on a changed phone, and typing is simply a phone change.
  phoneInput.addEventListener("input", () => {
    machine.setPhone(phoneInput.value);
  });

  if (changePhoneBtn) {
    changePhoneBtn.addEventListener("click", () => {
      machine.reset();
      phoneInput.focus();
    });
  }

  if (resendBtn) {
    resendBtn.addEventListener("click", () => {
      if (resendBtn.disabled) return;
      void machine.send();
    });
  }

  if (verifyBtn) {
    verifyBtn.addEventListener("click", () => {
      void machine.verify(codeInput.value);
    });
  }

  // Auto-verify when 6 digits are typed.
  codeInput.addEventListener("input", () => {
    codeInput.value = codeInput.value.replace(/\D/g, "").slice(0, 6);
    if (codeInput.value.length === 6) void machine.verify(codeInput.value);
  });

  // The gate: intercept submit until the phone is verified (or bypassed). The
  // token in the hidden input is what lets the native POST proceed.
  form.addEventListener(
    "submit",
    (event) => {
      if (tokenInput.value) return;
      event.preventDefault();
      if (submitBtn) submitBtn.disabled = false;
      machine.setPhone(phoneInput.value);
      void machine.send();
    },
    { capture: true }
  );

  return () => machine.dispose();
}

onEachPage(() => initOtpStep());
