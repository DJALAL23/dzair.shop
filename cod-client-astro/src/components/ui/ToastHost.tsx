import { useEffect } from "react";
import { Toaster } from "react-hot-toast";
import { useLocale } from "@/i18n/react";
import { consumeFlashToast } from "@/lib/notify";

export function ToastHost() {
  const locale = useLocale();
  const rtl = locale === "ar";

  useEffect(() => {
    consumeFlashToast();
  }, []);

  return (
    <Toaster
      position="bottom-center"
      gutter={8}
      containerStyle={{ bottom: 24, left: 16, right: 16 }}
      toastOptions={{
        duration: 4000,
        ariaProps: { role: "status", "aria-live": "polite" },
        style: {
          direction: rtl ? "rtl" : "ltr",
          maxWidth: "min(26rem, calc(100vw - 2rem))",
          padding: "10px 14px",
          borderRadius: "12px",
          background: "#1a1a1a",
          color: "#ffffff",
          boxShadow: "0 12px 32px -8px rgb(0 0 0 / 0.45), 0 0 0 1px rgb(255 255 255 / 0.08)",
          fontFamily: "var(--font-active)",
          fontSize: "var(--fs-sm)",
          fontWeight: 500,
          lineHeight: "1.4",
        },
        success: {
          iconTheme: { primary: "#5ed39a", secondary: "#1a1a1a" },
        },
        error: {
          duration: 6000,
          ariaProps: { role: "alert", "aria-live": "assertive" },
          iconTheme: { primary: "#ff8a7a", secondary: "#1a1a1a" },
        },
      }}
    />
  );
}
