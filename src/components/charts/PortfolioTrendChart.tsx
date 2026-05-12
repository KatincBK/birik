import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Skeleton } from "../Skeleton";
import { RangeChips } from "./RangeChips";
import { api, type ChartRange, type PortfolioHistoryPoint } from "../../lib/api";
import {
  formatCurrency,
  formatChange,
  changeClass,
  formatDate,
} from "../../lib/format";
import { cn } from "../../lib/cn";

const ACCENT = "#6FD3EC";
const NEUTRAL = "#A1A1AA";

type Props = {
  portfolioId: number | null;
  displayCurrency: string;
  defaultRange?: ChartRange;
};

export function PortfolioTrendChart({
  portfolioId,
  displayCurrency,
  defaultRange = "1m",
}: Props) {
  const [range, setRange] = useState<ChartRange>(defaultRange);
  const [rawPoints, setRawPoints] = useState<PortfolioHistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .fetchPortfolioHistory(portfolioId, range, displayCurrency)
      .then((h) => {
        if (cancelled) return;
        setRawPoints(h.points);
      })
      .catch(() => {
        if (!cancelled) setRawPoints([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [portfolioId, range, displayCurrency]);

  // Iki seri için birleşik data: her item hem realValue hem hypothValue alanı
  // taşır. Hypoth → real geçiş noktasında hypothValue'ya da değer yazılarak
  // çizgide kopukluk olmaması sağlanır (junction overlap).
  const data = useMemo(() => {
    if (rawPoints.length === 0) return [];
    return rawPoints.map((p, i) => {
      const prev = rawPoints[i - 1];
      const isJunction = prev?.is_hypothetical === true && !p.is_hypothetical;
      return {
        ts: p.ts,
        realValue: !p.is_hypothetical || isJunction ? p.value : null,
        hypothValue: p.is_hypothetical ? p.value : null,
        isHypoth: p.is_hypothetical,
      };
    });
  }, [rawPoints]);

  const latest = useMemo(() => {
    for (let i = rawPoints.length - 1; i >= 0; i--) {
      if (!rawPoints[i].is_hypothetical) return rawPoints[i].value;
    }
    return rawPoints[rawPoints.length - 1]?.value ?? 0;
  }, [rawPoints]);

  const hasHypoth = rawPoints.some((p) => p.is_hypothetical);
  const hasReal = rawPoints.some((p) => !p.is_hypothetical);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
            Portföy değer trendi
          </h2>
          {hasHypoth && hasReal && (
            <div className="flex items-center gap-3 text-[11px] text-(--color-text-tertiary)">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: NEUTRAL }}
                />
                Hipotetik
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: ACCENT }}
                />
                Gerçek
              </span>
            </div>
          )}
        </div>
        <RangeChips value={range} onChange={setRange} />
      </div>

      <div className="rounded-xl border border-(--color-border-subtle) bg-(--color-bg-panel) p-3">
        <div className="h-64">
          {loading ? (
            <Skeleton className="h-full w-full rounded-lg" />
          ) : data.length === 0 ? (
            <div className="grid h-full place-items-center text-center">
              <div>
                <p className="text-sm text-(--color-text-secondary)">
                  Bu aralık için grafik üretilemedi
                </p>
                <p className="mt-1 text-xs text-(--color-text-tertiary)">
                  Daha kısa bir aralık (1A) deneyin, ya da fiyat verileri
                  birikene kadar bekleyin. Yeni asset eklenince ilk fiyat
                  fetch'i biraz zaman alabilir.
                </p>
              </div>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={ACCENT} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="hypothFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={NEUTRAL} stopOpacity={0.16} />
                    <stop offset="100%" stopColor={NEUTRAL} stopOpacity={0} />
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
                    formatCurrency(v, displayCurrency, "summary")
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
                    const p = payload[0].payload as {
                      ts: number;
                      realValue: number | null;
                      hypothValue: number | null;
                      isHypoth: boolean;
                    };
                    const v = p.realValue ?? p.hypothValue ?? 0;
                    const delta = latest - v;
                    const pct = v > 0 ? (delta / v) * 100 : 0;
                    return (
                      <div className="rounded-lg border border-(--color-border-subtle) bg-(--color-bg-panel) px-3 py-2 text-xs shadow-lg">
                        <div className="flex items-baseline gap-2">
                          <span className="text-base font-semibold tabular text-(--color-text-primary)">
                            {formatCurrency(v, displayCurrency)}
                          </span>
                          {p.isHypoth && (
                            <span className="rounded bg-(--color-bg-base) px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-(--color-text-tertiary)">
                              hipotetik
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-[11px] text-(--color-text-tertiary)">
                          {formatDate(Math.floor(p.ts / 1000))}
                        </div>
                        {Math.abs(delta) > 0.01 && hasReal && (
                          <div
                            className={cn(
                              "mt-1 text-[11px] tabular",
                              changeClass(delta)
                            )}
                          >
                            Bugüne göre {pct >= 0 ? "+" : ""}
                            {pct.toFixed(2)}% (
                            {formatChange(delta, displayCurrency, "summary")})
                          </div>
                        )}
                      </div>
                    );
                  }}
                />
                {/* Hypothetical önce çiz — real seri üzerine binmez */}
                <Area
                  type="monotone"
                  dataKey="hypothValue"
                  stroke={NEUTRAL}
                  strokeWidth={2}
                  fill="url(#hypothFill)"
                  isAnimationActive
                  animationDuration={400}
                  animationEasing="ease-out"
                  dot={false}
                  connectNulls={false}
                  activeDot={{ r: 3, fill: NEUTRAL, strokeWidth: 0 }}
                />
                <Area
                  type="monotone"
                  dataKey="realValue"
                  stroke={ACCENT}
                  strokeWidth={3}
                  fill="url(#trendFill)"
                  isAnimationActive
                  animationDuration={400}
                  animationEasing="ease-out"
                  dot={false}
                  connectNulls={false}
                  activeDot={{ r: 4, fill: ACCENT, strokeWidth: 0 }}
                />
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
  return `${d.toLocaleString("tr-TR", { month: "short" })} ${d.getFullYear() % 100}`;
}
