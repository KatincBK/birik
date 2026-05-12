import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity } from "lucide-react";
import { Skeleton } from "../Skeleton";
import { RangeChips } from "./RangeChips";
import { api, type ChartRange, type Transaction } from "../../lib/api";
import { formatCurrency, formatDate } from "../../lib/format";
import { cn } from "../../lib/cn";

const ACCENT = "#6FD3EC";
const SUCCESS = "#10B981";
const DANGER = "#DC2626";

type Props = {
  assetId: number;
  assetCurrency: string;
  avgCost?: number | null;
  transactions?: Transaction[];
  defaultRange?: ChartRange;
};

/**
 * Asset detay grafiği — fiyat çizgisi + ortalama maliyet referans çizgisi +
 * alış/satış noktaları. Points asset.currency cinsinden, formatCurrency aynı
 * para biriminde gösterir.
 */
export function PriceChart({
  assetId,
  assetCurrency,
  avgCost,
  transactions = [],
  defaultRange = "1m",
}: Props) {
  const [range, setRange] = useState<ChartRange>(defaultRange);
  const [points, setPoints] = useState<[number, number][]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showMarkers, setShowMarkers] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .fetchAssetHistory(assetId, range)
      .then((h) => {
        if (cancelled) return;
        setPoints(h.points);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setPoints([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [assetId, range]);

  const data = useMemo(() => {
    return points.map(([ts, p]) => ({ ts, price: p }));
  }, [points]);

  // Range içine düşen transactions — başlangıç zamanına göre filtre
  const visibleTxns = useMemo(() => {
    if (data.length === 0) return [];
    const startMs = data[0].ts;
    const endMs = data[data.length - 1].ts;
    return transactions
      .filter((t) => {
        const ms = t.date * 1000;
        return ms >= startMs && ms <= endMs && t.is_deleted === 0;
      })
      .map((t) => ({
        ts: t.date * 1000,
        price: t.price,
        type: t.type,
        quantity: t.quantity,
        fee: t.fee,
      }));
  }, [data, transactions]);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
          Fiyat geçmişi
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowMarkers((v) => !v)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
              showMarkers
                ? "border-(--color-accent)/40 bg-(--color-accent)/15 text-(--color-accent)"
                : "border-(--color-border-subtle) text-(--color-text-tertiary) hover:text-(--color-text-secondary)"
            )}
            title="İşlem işaretleyicilerini göster/gizle"
          >
            <Activity className="h-3 w-3" />
            İşlemler
          </button>
          <RangeChips value={range} onChange={setRange} />
        </div>
      </div>

      <div className="rounded-xl border border-(--color-border-subtle) bg-(--color-bg-panel) p-3">
        <div className="h-72">
          {loading ? (
            <Skeleton className="h-full w-full rounded-lg" />
          ) : error || data.length === 0 ? (
            <div className="grid h-full place-items-center text-center">
              <div>
                <p className="text-sm text-(--color-text-secondary)">
                  {error
                    ? "Tarihsel veri çekilemedi"
                    : "Bu varlık için henüz tarihsel veri yok"}
                </p>
                {error && (
                  <p className="mt-1 text-xs text-(--color-text-tertiary)">
                    {error}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={ACCENT} stopOpacity={0.18} />
                    <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--color-border-subtle)" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="ts"
                  type="number"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={(ms: number) => formatTickX(ms, range)}
                  stroke="var(--color-text-tertiary)"
                  tick={{ fontSize: 10 }}
                  tickMargin={6}
                />
                <YAxis
                  domain={["auto", "auto"]}
                  stroke="var(--color-text-tertiary)"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v: number) =>
                    formatCurrency(v, assetCurrency, "summary")
                  }
                  width={70}
                />
                <Tooltip
                  cursor={{
                    stroke: "var(--color-border-strong)",
                    strokeDasharray: "3 3",
                  }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0].payload as { ts: number; price: number };
                    return (
                      <div className="rounded-lg border border-(--color-border-subtle) bg-(--color-bg-panel) px-3 py-2 text-xs shadow-lg">
                        <div className="text-base font-semibold tabular text-(--color-text-primary)">
                          {formatCurrency(p.price, assetCurrency)}
                        </div>
                        <div className="mt-0.5 text-[11px] text-(--color-text-tertiary)">
                          {formatDate(Math.floor(p.ts / 1000))}
                        </div>
                      </div>
                    );
                  }}
                />
                {avgCost != null && avgCost > 0 && (
                  <ReferenceLine
                    y={avgCost}
                    stroke="var(--color-text-tertiary)"
                    strokeDasharray="4 4"
                    strokeWidth={1}
                    label={{
                      value: `Ort. maliyet ${formatCurrency(avgCost, assetCurrency, "summary")}`,
                      position: "right",
                      fill: "var(--color-text-tertiary)",
                      fontSize: 10,
                    }}
                  />
                )}
                <Area
                  type="monotone"
                  dataKey="price"
                  stroke={ACCENT}
                  strokeWidth={2}
                  fill="url(#priceFill)"
                  isAnimationActive
                  animationDuration={400}
                  animationEasing="ease-out"
                  dot={false}
                  activeDot={{ r: 4, fill: ACCENT, strokeWidth: 0 }}
                />
                {showMarkers &&
                  visibleTxns.map((t, i) => {
                    const fill =
                      t.type === "buy"
                        ? SUCCESS
                        : t.type === "sell"
                        ? DANGER
                        : ACCENT;
                    return (
                      <ReferenceDot
                        key={i}
                        x={t.ts}
                        y={t.price}
                        r={5}
                        fill={fill}
                        stroke="var(--color-bg-panel)"
                        strokeWidth={2}
                        ifOverflow="extendDomain"
                      />
                    );
                  })}
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </section>
  );
}

function formatTickX(ms: number, range: ChartRange): string {
  const d = new Date(ms);
  if (range === "1d") {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  if (range === "1w" || range === "1m") {
    return `${d.getDate()}/${d.getMonth() + 1}`;
  }
  // 3m, 1y, max
  return `${d.toLocaleString("tr-TR", { month: "short" })} ${d.getFullYear() % 100}`;
}
