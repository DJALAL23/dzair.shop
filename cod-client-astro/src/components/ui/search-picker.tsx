import { useEffect, useId, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { useT } from "@/i18n/react";
import { inputClass } from "./input";

export interface PickerOption {
  id: string;
  label: string;
  /** A second line: a phone, an SKU. */
  detail?: string;
}

/**
 * Choose one record by searching for it: type, pick from what matches,
 * clear to choose again. `search` is asked as the merchant types (after a
 * short pause) and once on focus with an empty query, so a short list shows
 * before typing.
 */
export function SearchPicker({
  value,
  onChange,
  search,
  placeholder,
  emptyLabel,
  "aria-label": ariaLabel,
  disabled = false,
}: {
  value: PickerOption | null;
  onChange: (option: PickerOption | null) => void;
  search: (query: string) => Promise<PickerOption[]>;
  placeholder: string;
  /** Shown when nothing matches. */
  emptyLabel: string;
  "aria-label"?: string;
  disabled?: boolean;
}) {
  const common = useT("common");
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<PickerOption[] | null>(null);
  const ticket = useRef(0);
  const searchRef = useRef(search);
  searchRef.current = search;

  useEffect(() => {
    if (!open || value) return;
    const mine = ++ticket.current;
    const timer = window.setTimeout(async () => {
      try {
        const found = await searchRef.current(query.trim());
        if (mine === ticket.current) setOptions(found);
      } catch {
        if (mine === ticket.current) setOptions([]);
      }
    }, query ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [query, open, value]);

  if (value) {
    return (
      <div className={`${inputClass} flex items-center gap-2`}>
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium text-foreground">{value.label}</span>
          {value.detail && (
            <span className="ms-2 text-xs text-muted-foreground" dir="auto">
              {value.detail}
            </span>
          )}
        </span>
        {!disabled && (
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setQuery("");
              setOptions(null);
            }}
            aria-label={common("clear")}
            className="grid size-7 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X size={14} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search size={14} aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={ariaLabel ?? placeholder}
          value={query}
          disabled={disabled}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
          className={`${inputClass} ps-9`}
        />
      </div>
      {open && options && (
        <ul id={listId} role="listbox" className="mt-1.5 max-h-56 overflow-y-auto rounded-md border border-border bg-background">
          {options.length === 0 && <li className="px-3 py-2.5 text-sm text-muted-foreground">{emptyLabel}</li>}
          {options.slice(0, 8).map((option) => (
            <li key={option.id} role="option" aria-selected={false}>
              <button
                type="button"
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                }}
                className="flex min-h-11 w-full items-center gap-3 border-b border-border px-3 text-start last:border-0 hover:bg-muted"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{option.label}</span>
                  {option.detail && (
                    <span className="block truncate text-xs text-muted-foreground" dir="auto">
                      {option.detail}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
