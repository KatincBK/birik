import { useMemo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { assetTypeColor, assetTypeLabel } from "../../lib/colors";
import { formatCurrency } from "../../lib/format";
import { cn } from "../../lib/cn";
import { effectiveType } from "../../lib/cashLike";
import { useSettingsStore } from "../../stores/useSettingsStore";
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

/** Asset modunda gösterilecek max dilim sayısı. Üstü "Diğer" altında toplanır. */
const ASSET_TOP_N = 15;

export function AllocationPie({
  assets,
  displayCurrency,
  mode = "type",
  onSliceClick,
}: {
  assets: AssetStats[];
  displayCurrency: string;
  mode?: "type" | "platform" | "asset";
  /** Platform mode'da: dilim tıklanınca key ("—" = atanmamış) */
  onSliceClick?: (key: string) => void;
}) {
  const cashExtraSymbols = useSettingsStore((s) => s.cashExtraSymbols);
  const commodityExtraSymbols = useSettingsStore((s) => s.commodityExtraSymbols);
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
    if (mode === "asset") {
      // Sembol bazında topla — aynı asset farklı portföylerden geliyorsa birleştir.
      const totals = new Map<string, { value: number; label: string }>();
      for (const a of assets) {
        if (!a.market_value_display) continue;
        const key = `${a.symbol}|${a.asset_type}`;
        const cur = totals.get(key);
        const label = a.symbol;
        if (cur) {
          cur.value += a.market_value_display;
        } else {
          totals.set(key, { value: a.market_value_display, label });
        }
      }
      const sorted = Array.from(totals.entries())
        .map(([key, { value, label }]) => ({ key, value, label }))
        .filter((d) => d.value > 0)
        .sort((a, b) => b.value - a.value);

      if (sorted.length <= ASSET_TOP_N) {
        return sorted.map((d, i) => ({
          ...d,
          fill: PLATFORM_PALETTE[i % PLATFORM_PALETTE.length],
        }));
      }
      const top = sorted.slice(0, ASSET_TOP_N);
      const others = sorted.slice(ASSET_TOP_N);
      const otherValue = others.reduce((s, x) => s + x.value, 0);
      const out = top.map((d, i) => ({
        ...d,
        fill: PLATFORM_PALETTE[i % PLATFORM_PALETTE.length],
      }));
      out.push({
        key: "__other__",
        value: otherValue,
        label: `Diğer (${others.length})`,
        fill: "#6B6B75",
      });
      return out;
    }
    // Tip bazlı (default) — cash-like ve commodity-like asset'ler ayrı dilime düşer
    const totals = new Map<string, number>();
    for (const a of assets) {
      if (!a.market_value_display) continue;
      const t = effectiveType(a, cashExtraSymbols, commodityExtraSymbols);
      totals.set(t, (totals.get(t) ?? 0) + a.market_value_display);
    }
    return Array.from(totals.entries())
      .filter(([, v]) => v > 0)
      .map(([type, value]) => ({
        key: type,
        value,
        label: assetTypeLabel(type),
        fill: assetTypeColor(type),
      }));
  }, [assets, mode, cashExtraSymbols, commodityExtraSymbols]);

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
            isAnimationActive
            animationDuration={350}
            animationEasing="ease-out"
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
