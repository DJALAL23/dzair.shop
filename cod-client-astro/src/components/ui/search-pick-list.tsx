import { X } from "lucide-react";
import { useT } from "@/i18n/react";
import { SearchPicker, type PickerOption } from "./search-picker";

/**
 * Choose several records by searching for them: each one picked joins the
 * list below, and each can be taken out again. Search answers leave out what
 * is already picked. `max` stops the picker once the list is full.
 */
export function SearchPickList({
  value,
  onChange,
  search,
  placeholder,
  emptyLabel,
  max,
  disabled = false,
}: {
  value: PickerOption[];
  onChange: (next: PickerOption[]) => void;
  search: (query: string) => Promise<PickerOption[]>;
  placeholder: string;
  /** Shown when nothing matches. */
  emptyLabel: string;
  max?: number;
  disabled?: boolean;
}) {
  const common = useT("common");
  const picked = new Set(value.map((option) => option.id));
  const full = max !== undefined && value.length >= max;
  return (
    <div className="space-y-2">
      {!full && (
        <SearchPicker
          value={null}
          onChange={(option) => option && !picked.has(option.id) && onChange([...value, option])}
          search={async (query) => (await search(query)).filter((option) => !picked.has(option.id))}
          placeholder={placeholder}
          emptyLabel={emptyLabel}
          aria-label={placeholder}
          disabled={disabled}
        />
      )}
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((option) => (
            <li key={option.id} className="flex max-w-full items-center gap-1 rounded-md border border-border bg-subtle py-1 ps-2.5 pe-1 text-sm text-foreground">
              <span className="min-w-0 truncate">
                {option.label}
                {option.detail && (
                  <span className="ms-1.5 text-xs text-muted-foreground" dir="auto">
                    {option.detail}
                  </span>
                )}
              </span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onChange(value.filter((entry) => entry.id !== option.id))}
                  aria-label={common("remove_item", { name: option.label })}
                  className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
