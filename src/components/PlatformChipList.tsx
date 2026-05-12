import { MoreHorizontal } from "lucide-react";
import { cn } from "../lib/cn";

const VISIBLE_LIMIT = 4;

/**
 * Bilinen platform chip listesi — modal'larda tekrar kullanılır. İlk N chip
 * görünür, fazlası varsa "+M" butonu ile expand. Tüm butonlar onMouseDown
 * preventDefault ile parent input'un blur'unu engeller.
 */
export function PlatformChipList({
  items,
  value,
  onSelect,
  expanded,
  onToggleExpand,
}: {
  items: string[];
  value: string;
  onSelect: (p: string) => void;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const visibleCount = expanded ? items.length : VISIBLE_LIMIT;
  const visible = items.slice(0, visibleCount);
  const hiddenCount = items.length - visibleCount;

  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {visible.map((p) => (
        <button
          key={p}
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onSelect(p)}
          className={cn(
            "rounded-md border px-2 py-0.5 text-[11px] transition-colors",
            value === p
              ? "border-(--color-accent)/40 bg-(--color-accent)/15 text-(--color-accent)"
              : "border-(--color-border-subtle) bg-(--color-bg-base) text-(--color-text-secondary) hover:border-(--color-accent)/40 hover:text-(--color-accent)"
          )}
        >
          {p}
        </button>
      ))}
      {hiddenCount > 0 && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onToggleExpand}
          title={`${hiddenCount} platform daha`}
          className="inline-flex items-center gap-0.5 rounded-md border border-dashed border-(--color-border-subtle) bg-(--color-bg-base) px-2 py-0.5 text-[11px] text-(--color-text-tertiary) transition-colors hover:border-(--color-accent)/40 hover:text-(--color-accent)"
        >
          <MoreHorizontal className="h-3 w-3" />
          {`+${hiddenCount}`}
        </button>
      )}
      {expanded && items.length > VISIBLE_LIMIT && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onToggleExpand}
          className="rounded-md border border-(--color-border-subtle) bg-(--color-bg-base) px-2 py-0.5 text-[11px] text-(--color-text-tertiary) transition-colors hover:text-(--color-text-secondary)"
        >
          azalt
        </button>
      )}
    </div>
  );
}
