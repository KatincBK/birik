import { cn } from "../../lib/cn";
import type { ChartRange } from "../../lib/api";

const RANGES: { key: ChartRange; label: string }[] = [
  { key: "1d", label: "1G" },
  { key: "1w", label: "1H" },
  { key: "1m", label: "1A" },
  { key: "3m", label: "3A" },
  { key: "1y", label: "1Y" },
  { key: "max", label: "Tümü" },
];

export function RangeChips({
  value,
  onChange,
}: {
  value: ChartRange;
  onChange: (r: ChartRange) => void;
}) {
  return (
    <div className="inline-flex gap-0.5 rounded-lg border border-(--color-border-subtle) bg-(--color-bg-panel) p-1">
      {RANGES.map((r) => (
        <button
          key={r.key}
          onClick={() => onChange(r.key)}
          className={cn(
            "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
            r.key === value
              ? "border border-(--color-accent)/40 bg-(--color-accent)/15 text-(--color-accent)"
              : "border border-transparent text-(--color-text-secondary) hover:text-(--color-text-primary)"
          )}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}
