import { Search, X } from "lucide-react";
import { useT } from "@/i18n/react";

/** Search field with a one-click clear button. */
export function SearchInput({
  value,
  onChange,
  placeholder,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
}) {
  const common = useT("common");
  return (
    <label className={`relative block min-w-0 flex-1 ${className}`}>
      <Search
        size={15}
        strokeWidth={1.9}
        className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={placeholder}
        className="h-8 w-full ps-8 pe-8 pointer-coarse:h-10 rounded-lg border border-input bg-card text-sm text-foreground outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-subtle-foreground hover:border-foreground/45 focus:border-ring focus:shadow-[0_0_0_1px_var(--ring)] disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={common("cancel")}
          className="absolute end-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
        >
          <X size={13} />
        </button>
      )}
    </label>
  );
}
