import { SwitchField } from "@/components/ui";

/**
 * The delivery options, as switches.
 *
 * The last option left on cannot be switched off. Preventing the state is better
 * than reporting it: a form with no delivery option takes no orders at all, so
 * there is no moment where letting the merchant reach it helps them. The server
 * refuses it too — the API is its own trust boundary — but nobody should have to
 * be told by an error what the screen could simply not offer. The reason sits
 * behind the ⓘ of the option that is held on.
 */
export function DeliveryOptionCards({
  value,
  onChange,
  homeLabel,
  stopDeskLabel,
  lastOneHint,
}: {
  value: { home: boolean; stopDesk: boolean };
  onChange: (next: { home: boolean; stopDesk: boolean }) => void;
  homeLabel: string;
  stopDeskLabel: string;
  lastOneHint: string;
}) {
  const enabledCount = (value.home ? 1 : 0) + (value.stopDesk ? 1 : 0);
  const options = [
    { key: "home", label: homeLabel, on: value.home },
    { key: "stopDesk", label: stopDeskLabel, on: value.stopDesk },
  ] as const;

  return (
    <div className="divide-y divide-border">
      {options.map(({ key, label, on }) => {
        const isLastOn = on && enabledCount === 1;
        return (
          <div key={key} className="py-2.5 first:pt-0 last:pb-0">
            <SwitchField
              label={label}
              help={isLastOn ? lastOneHint : undefined}
              checked={on}
              disabled={isLastOn}
              onChange={(next) => onChange({ ...value, [key]: next })}
            />
          </div>
        );
      })}
    </div>
  );
}
