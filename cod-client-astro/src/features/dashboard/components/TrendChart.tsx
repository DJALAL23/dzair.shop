import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { ActivityDay } from "@/features/dashboard/model";

const HEIGHT = 220;
const PAD = { top: 12, right: 8, bottom: 28, left: 48 };

function niceCeiling(value: number) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * magnitude >= value) return step * magnitude;
  return 10 * magnitude;
}

/**
 * One measure over the window's days: a 2px line on a faint area, three quiet
 * gridlines, and a crosshair that snaps to the nearest day under the pointer
 * or the arrow keys. A hidden table carries every value for screen readers.
 */
export function TrendChart({
  days,
  value,
  formatValue,
  formatTick,
  formatDay,
  caption,
}: {
  days: ActivityDay[];
  value: (day: ActivityDay) => number;
  formatValue: (value: number) => string;
  formatTick: (value: number) => string;
  formatDay: (date: string, style: "short" | "long") => string;
  caption: string;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const gradientId = useId();

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const values = days.map(value);
  const top = niceCeiling(Math.max(...values, 0));
  const plotWidth = Math.max(width - PAD.left - PAD.right, 1);
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const x = (index: number) => PAD.left + (days.length === 1 ? plotWidth / 2 : (index / (days.length - 1)) * plotWidth);
  const y = (amount: number) => PAD.top + plotHeight - (amount / top) * plotHeight;
  const points = values.map((amount, index) => `${x(index).toFixed(1)},${y(amount).toFixed(1)}`);
  const line = `M${points.join("L")}`;
  const area = `${line}L${x(days.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;
  const ticks = [0, top / 2, top];
  const labelled = [0, Math.floor((days.length - 1) / 2), days.length - 1].filter((index, position, all) => all.indexOf(index) === position);

  function nearest(event: PointerEvent<SVGRectElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - box.left) / box.width;
    setActive(Math.min(days.length - 1, Math.max(0, Math.round(ratio * (days.length - 1)))));
  }

  function step(event: KeyboardEvent<SVGSVGElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowRight" ? 1 : -1;
    setActive((current) => Math.min(days.length - 1, Math.max(0, (current ?? days.length - 1) + (current === null ? 0 : delta))));
  }

  const tip = active === null ? null : { left: x(active), top: y(values[active]) };

  return (
    <div ref={frameRef} dir="ltr" className="relative select-none">
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={caption}
          tabIndex={0}
          onKeyDown={step}
          onBlur={() => setActive(null)}
          className="block overflow-visible rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-trend)" stopOpacity="0.14" />
              <stop offset="100%" stopColor="var(--chart-trend)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} stroke="var(--border)" strokeDasharray={tick === 0 ? undefined : "2 4"} />
              <text x={PAD.left - 10} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-[var(--muted-foreground)] text-[11px] tabular-nums">
                {formatTick(tick)}
              </text>
            </g>
          ))}
          {labelled.map((index) => (
            <text
              key={index}
              x={x(index)}
              y={HEIGHT - 8}
              textAnchor={index === 0 ? "start" : index === days.length - 1 ? "end" : "middle"}
              className="fill-[var(--muted-foreground)] text-[11px]"
            >
              {formatDay(days[index].date, "short")}
            </text>
          ))}
          <path d={area} fill={`url(#${gradientId})`} />
          <path d={line} fill="none" stroke="var(--chart-trend)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {tip && (
            <g pointerEvents="none">
              <line x1={tip.left} x2={tip.left} y1={PAD.top} y2={y(0)} stroke="var(--muted-foreground)" strokeOpacity="0.4" />
              <circle cx={tip.left} cy={tip.top} r={4.5} fill="var(--chart-trend)" stroke="var(--card)" strokeWidth={2} />
            </g>
          )}
          <rect
            x={PAD.left}
            y={PAD.top}
            width={plotWidth}
            height={plotHeight}
            fill="transparent"
            onPointerMove={nearest}
            onPointerDown={nearest}
            onPointerLeave={() => setActive(null)}
          />
        </svg>
      )}
      {tip && active !== null && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg bg-popover px-2.5 py-1.5 text-center shadow-popover"
          style={{ left: Math.min(Math.max(tip.left, 70), width - 70), top: tip.top - 10 }}
        >
          <span className="block text-sm font-semibold tabular-nums text-foreground">{formatValue(values[active])}</span>
          <span className="block text-xs text-muted-foreground">{formatDay(days[active].date, "long")}</span>
        </div>
      )}
      {width === 0 && <div style={{ height: HEIGHT }} />}
      <table className="sr-only">
        <caption>{caption}</caption>
        <tbody>
          {days.map((day, index) => (
            <tr key={day.date}>
              <th scope="row">{formatDay(day.date, "long")}</th>
              <td>{formatValue(values[index])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
