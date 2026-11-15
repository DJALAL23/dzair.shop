import { ApiError } from "@/lib/api";
import { useT } from "@/i18n/react";

const BY_CODE: Record<string, string> = {
  NOT_TEAM_MEMBER: "errors.not_member",
  USER_INACTIVE: "errors.inactive",
  NO_ORDER_ACCESS: "errors.no_order_access",
  ALREADY_TEAM_MEMBER: "errors.already_member",
  ORDER_NOT_WAITING: "errors.not_waiting",
  USER_NOT_FOUND: "errors.gone",
  PAY_RATE_NOT_FOUND: "errors.gone",
};

/** What went wrong, said in the merchant's language: the server's code when it is one the team knows, else `fallback`. */
export function useTeamError() {
  const t = useT("confirmation");
  return (cause: unknown, fallback: string) => {
    if (cause instanceof ApiError) {
      const key = cause.code ? BY_CODE[cause.code] : undefined;
      if (key) return t(key);
      if (cause.status === 403) return t("errors.forbidden");
    }
    return t(fallback);
  };
}
