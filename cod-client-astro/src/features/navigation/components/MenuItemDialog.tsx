import { useState } from "react";
import { Link2 } from "lucide-react";
import { Button, Dialog, Field, Input, SearchPicker, Select, type PickerOption } from "@/components/ui";
import { useT } from "@/i18n/react";
import { searchMenuDestinations } from "@/features/navigation/api";
import { itemProblem, type EditableItem } from "@/features/navigation/model";
import type { MenuDestination, MenuDestinationType, MenuResourceType } from "@/features/navigation/types";

const TYPES: MenuDestinationType[] = ["home", "catalog", "category", "product", "page", "landing", "url"];
const isResource = (type: MenuDestinationType): type is MenuResourceType =>
  type === "category" || type === "product" || type === "page" || type === "landing";

export type ItemChange = Pick<EditableItem, "label" | "destination" | "destinationLabel">;

/** Add or edit one menu item: what it says, and where it leads. */
export function MenuItemDialog({
  item,
  onSave,
  onClose,
}: {
  /** The item edited, or null to add one. */
  item: EditableItem | null;
  onSave: (change: ItemChange) => void;
  onClose: () => void;
}) {
  const t = useT("menus");
  const common = useT("common");
  const [label, setLabel] = useState(item?.label ?? "");
  const [type, setType] = useState<MenuDestinationType>(item?.destination.type ?? "catalog");
  const [picked, setPicked] = useState<PickerOption | null>(
    item && "ref" in item.destination ? { id: item.destination.ref, label: item.destinationLabel ?? item.destination.ref } : null,
  );
  const [url, setUrl] = useState(item?.destination.type === "url" ? item.destination.url : "");
  const [showErrors, setShowErrors] = useState(false);

  const destination: MenuDestination =
    type === "url" ? { type, url: url.trim() } : isResource(type) ? { type, ref: picked?.id ?? "" } : { type };
  const problem = itemProblem({ label, destination });

  function save() {
    if (problem) {
      setShowErrors(true);
      return;
    }
    onSave({ label: label.trim(), destination, destinationLabel: isResource(type) ? picked?.label ?? null : null });
  }

  async function search(query: string): Promise<PickerOption[]> {
    if (!isResource(type)) return [];
    const options = await searchMenuDestinations(type, query);
    return options.map((option) => ({
      id: option.id,
      label: option.label,
      detail: option.visible ? option.path : `${option.path} · ${t("item.not_visible")}`,
    }));
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={item ? t("item.edit_title") : t("item.add_title")}
      icon={<Link2 size={18} aria-hidden="true" />}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {common("cancel")}
          </Button>
          <Button onClick={save}>{item ? t("item.apply") : t("item.add")}</Button>
        </div>
      }
    >
      <div className="space-y-4 py-1">
        <Field label={t("item.destination")} as="div">
          <Select
            value={type}
            onChange={(event) => {
              setType(event.currentTarget.value as MenuDestinationType);
              setPicked(null);
            }}
            aria-label={t("item.destination")}
          >
            {TYPES.map((value) => (
              <option key={value} value={value}>
                {t(`destination.${value}`)}
              </option>
            ))}
          </Select>
        </Field>

        {isResource(type) && (
          <Field label={t(`pick.${type}`)} as="div" error={showErrors && problem === "destination" ? t("item.pick_required") : undefined}>
            <SearchPicker
              key={type}
              value={picked}
              onChange={(option) => {
                setPicked(option);
                if (option && !label.trim()) setLabel(option.label.slice(0, 100));
              }}
              search={search}
              placeholder={t("pick.placeholder")}
              emptyLabel={t("pick.empty")}
              aria-label={t(`pick.${type}`)}
            />
          </Field>
        )}

        {type === "url" && (
          <Field label={t("item.url")} hint={t("item.url_hint")} error={showErrors && problem === "url" ? t("item.url_invalid") : undefined}>
            <Input value={url} onChange={(event) => setUrl(event.currentTarget.value)} dir="ltr" placeholder="https://instagram.com/…" />
          </Field>
        )}

        <Field label={t("item.label")} error={showErrors && problem === "label" ? t("item.label_required") : undefined}>
          <Input value={label} onChange={(event) => setLabel(event.currentTarget.value)} maxLength={100} placeholder={t("item.label_placeholder")} />
        </Field>
      </div>
    </Dialog>
  );
}
