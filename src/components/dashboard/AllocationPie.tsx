import { useMemo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { assetTypeColor, assetTypeLabel } from "../../lib/colors";
import { formatCurrency } from "../../lib/format";
import { cn } from "../../lib/cn";
import type { AssetStats } from "../../lib/api";

const PLATFORM_PALETTE = [
  "#6FD3EC",
  "#A78BFA",
  "#F59E0B",
  "#2DD4BF",
  "#FB7185",
  "#FACC15",
  "#38BDF8",
  "#10B981",
  "#FF8B7A",
];

export function AllocationPie({
  assets,
  displayCurrency,
  mode = "type",
  onSliceClick,
}: {
  assets: AssetStats[];
  displayCurrency: string;
  mode?: "type" | "platform";
  /** Platform mode'da: dilim tıklanınca key ("—" = atanmamış) */
  onSliceClick?: (key: string) => void;
}) {
  const data = useMemo(() => {
    if (mode === "platform") {
      const totals = new Map<string, number>();
      for (const a of assets) {
        if (!a.market_value_display) continue;
        const key = a.platform?.trim() || "—";
        totals.set(key, (totals.get(key) ?? 0) + a.market_value_display);
      }
      return Array.from(totals.entries())
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([platform, value], i) => ({
          key: platform,
          value,
          label: platform === "—" ? "Platform belirtilmemiş" : platform,
          fill: PLATFORM_PALETTE[i % PLATFORM_PALETTE.length],
        }));
    }
    // Tip bazlı (default)
    const totals = new Map<string, number>();
    for (const a of assets) {
      if (!a.market_value_display) continue;
      totals.set(
        a.asset_type,
        (totals.get(a.asset_type) ?? 0) + a.market_value_display
      );
    }
    return Array.from(totals.entries())
      .filter(([, v]) => v > 0)
      .map(([type, value]) => ({
        key: type,
        value,
        label: assetTypeLabel(type),
        fill: assetTypeColor(type),
      }));
  }, [assets, mode]);

  if (data.length === 0) {
    return (
      <div className="grid h-full place-items-center text-center">
        <div>
          <div className="mx-auto mb-3 h-32 w-32 rounded-full border-2 border-dashed border-(--color-border-subtle)" />
          <p className="text-sm text-(--color-text-secondary)">
            Bir varlık ekleyince burası canlanır.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <ResponsiveContainer width="100%" height="80%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius="55%"
            outerRadius="80%"
            paddingAngle={2}
            stroke="none"
            onClick={(e: any) => {
              if (onSliceClick && e?.payload?.key) onSliceClick(e.payload.key);
            }}
          >
            {data.map((d) => (
              <Cell
                key={d.key}
                fill={d.fill}
                cursor={onSliceClick ? "pointer" : undefined}
              />
            ))}
          </Pie>
          <Tooltip
            cursor={false}
            contentStyle={{
              background: "var(--color-bg-panel)",
              border: "1px solid var(--color-border-subtle)",
              borderRadius: 8,
              color: "var(--color-text-primary)",
              fontSize: 12,
            }}
            formatter={(v) => formatCurrency(Number(v), displayCurrency, "summary")}
          />
        </PieChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
        {data.map((d) => {
          const unassigned = mode === "platform" && d.key === "—";
          return (
            <button
              key={d.key}
              type="button"
              onClick={() => onSliceClick?.(d.key)}
              disabled={!onSliceClick}
              className={cn(
                "flex items-center gap-1.5 text-xs text-(--color-text-secondary) transition-colors",
                onSliceClick && "hover:text-(--color-text-primary)",
                unassigned && onSliceClick && "text-(--color-accent)"
              )}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: d.fill }}
              />
              {unassigned ? "+ Platform ata" : d.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
