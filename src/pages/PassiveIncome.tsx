import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Sparkles, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "../components/Skeleton";
import { AssetIcon } from "../components/AssetIcon";
import {
  api,
  type AssetStats,
  type DividendProjection,
  type PassiveIncomeStats,
  type PortfolioStats,
} from "../lib/api";
import { usePortfolioStore } from "../stores/portfolioStore";
import { useProfileStore } from "../stores/profileStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { formatCurrency } from "../lib/format";
import { cn } from "../lib/cn";
import { playSound } from "../lib/sounds";

type Period = "30d" | "90d" | "1y" | "ytd" | "all";

const PERIODS: { key: Period; label: string }[] = [
  { key: "30d", label: "30 gün" },
  { key: "90d", label: "90 gün" },
  { key: "1y", label: "1 yıl" },
  { key: "ytd", label: "Yıl içi" },
  { key: "all", label: "Hepsi" },
];

const SOURCE_COLORS: Record<string, string> = {
  staking: "#F59E0B",
  dividend: "#38BDF8",
  interest: "#2DD4BF",
};

const SOURCE_LABELS: Record<string, string> = {
  staking: "Staking",
  dividend: "Temettü",
  interest: "Faiz",
};

const FREQ_LABELS: Record<string, string> = {
  monthly: "Aylık",
  quarterly: "Çeyreklik",
  semiannual: "6 aylık",
  annual: "Yıllık",
  irregular: "Düzensiz",
  none: "Temettü yok",
  stopped: "Kesilmiş",
};

export function PassiveIncome() {
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const portfolios = usePortfolioStore((s) => s.portfolios);
  const profileId = useProfileStore((s) => s.activeId);
  const [period, setPeriod] = useState<Period>("all");
  const [stats, setStats] = useState<PassiveIncomeStats | null>(null);
  const [loading, setLoading] = useState(true);

  // Beklenen yıllık getiri editörü için aktif profilin tüm asset'leri
  const [assets, setAssets] = useState<AssetStats[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");

  // Hisse temettü projeksiyonları (otomatik — geçmiş veriden öngörü).
  // annual_display backend'de display currency'ye çevrilmiş gelir.
  const [dividends, setDividends] = useState<DividendProjection[]>([]);
  const [dividendsLoading, setDividendsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .calculatePassiveIncome(null, displayCurrency, period)
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch(() => {
        if (!cancelled) setStats(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [displayCurrency, period]);

  // Profilin portföylerinden tüm asset'leri topla
  useEffect(() => {
    let cancelled = false;
    setAssetsLoading(true);
    Promise.all(
      portfolios.map((p) => api.calculatePortfolio(p.id, displayCurrency))
    )
      .then((results: PortfolioStats[]) => {
        if (cancelled) return;
        const flat: AssetStats[] = [];
        for (const r of results) flat.push(...r.assets);
        flat.sort(
          (a, b) =>
            (b.market_value_display ?? 0) - (a.market_value_display ?? 0)
        );
        setAssets(flat);
      })
      .catch(() => {
        if (!cancelled) setAssets([]);
      })
      .finally(() => {
        if (!cancelled) setAssetsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [portfolios, displayCurrency]);

  // Hisse temettü projeksiyonları — backend display currency'ye çevirir,
  // o yüzden displayCurrency değişince yeniden çekilir.
  useEffect(() => {
    if (profileId == null) {
      setDividends([]);
      setDividendsLoading(false);
      return;
    }
    let cancelled = false;
    setDividendsLoading(true);
    api
      .projectDividends(profileId, displayCurrency)
      .then((divs) => {
        if (!cancelled) setDividends(divs);
      })
      .catch(() => {
        if (!cancelled) setDividends([]);
      })
      .finally(() => {
        if (!cancelled) setDividendsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profileId, displayCurrency]);

  const dividendMap = useMemo(() => {
    const m = new Map<number, DividendProjection>();
    for (const d of dividends) m.set(d.asset_id, d);
    return m;
  }, [dividends]);

  /** Bir varlığın yıllık projeksiyonu (display currency). Hisse → otomatik
   *  temettü projeksiyonu (backend zaten display'e çevirdi); diğer →
   *  market_value × expected_yield_pct. */
  const annualFor = (a: AssetStats): number | null => {
    if (a.asset_type === "stock") {
      const d = dividendMap.get(a.asset_id);
      if (!d || d.annual_display <= 0) return null;
      return d.annual_display;
    }
    if (a.market_value_display != null && a.expected_yield_pct != null) {
      return (a.market_value_display * a.expected_yield_pct) / 100;
    }
    return null;
  };

  const totalAnnualEstimate = useMemo(() => {
    return assets.reduce((acc, a) => acc + (annualFor(a) ?? 0), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets, dividendMap]);

  const startEdit = (a: AssetStats) => {
    setEditingId(a.asset_id);
    setEditValue(a.expected_yield_pct != null ? a.expected_yield_pct.toString() : "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValue("");
  };

  const saveEdit = async (assetId: number) => {
    const trimmed = editValue.trim();
    const next =
      trimmed === ""
        ? null
        : parseFloat(trimmed.replace(",", "."));
    if (next != null && (!Number.isFinite(next) || next < 0)) {
      playSound("error");
      toast.error("Geçersiz yüzde değeri");
      return;
    }
    try {
      await api.updateAssetYield(assetId, next);
      setAssets((cur) =>
        cur.map((a) =>
          a.asset_id === assetId ? { ...a, expected_yield_pct: next } : a
        )
      );
      playSound("ding");
      cancelEdit();
    } catch (err) {
      playSound("error");
      toast.error("Kaydedilemedi", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const breakdownData = stats
    ? Object.entries(stats.breakdown)
        .filter(([k, v]) => k !== "total" && v > 0)
        .map(([k, v]) => ({
          source: k,
          value: v,
          label: SOURCE_LABELS[k] ?? k,
          fill: SOURCE_COLORS[k] ?? "#6B6B75",
        }))
    : [];

  const monthlyData = stats?.monthly.map(([m, v]) => ({ month: m, value: v })) ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <header className="flex items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-(--color-accent)/15 text-(--color-accent)">
            <Sparkles className="h-5 w-5" strokeWidth={2.25} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Pasif nakit akışı</h1>
            <p className="text-sm text-(--color-text-secondary)">
              Beklenen getiri & gerçekleşen staking, temettü, faiz.
            </p>
          </div>
        </div>

        <div className="flex gap-1 rounded-lg border border-(--color-border-subtle) bg-(--color-bg-panel) p-1">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                p.key === period
                  ? "bg-(--color-bg-hover) text-(--color-text-primary)"
                  : "text-(--color-text-secondary) hover:text-(--color-text-primary)"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </header>

      {/* Beklenen yıllık getiri — varlık başına yield_pct edit */}
      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
              Beklenen yıllık getiri
            </h2>
            <p className="mt-1 text-xs text-(--color-text-tertiary)">
              Hisse temettüleri geçmiş veriden otomatik öngörülür; kripto/emtia
              için yıllık getiri yüzdesini elle gir.
            </p>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-medium tracking-[0.05em] text-(--color-text-tertiary) uppercase">
              Yıllık toplam
            </div>
            <div className="text-xl font-semibold tabular text-(--color-accent)">
              {assetsLoading || dividendsLoading
                ? "—"
                : formatCurrency(totalAnnualEstimate, displayCurrency, "summary")}
            </div>
            {!assetsLoading && !dividendsLoading && totalAnnualEstimate > 0 && (
              <div className="text-[11px] text-(--color-text-tertiary) tabular">
                ≈ {formatCurrency(totalAnnualEstimate / 12, displayCurrency, "summary")}
                /ay
              </div>
            )}
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-(--color-border-subtle) bg-(--color-bg-panel)">
          {assetsLoading ? (
            <div className="space-y-1 p-3">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : assets.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-(--color-text-tertiary)">
              Henüz varlık yok.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-(--color-border-subtle) bg-(--color-bg-base)/40 text-(--color-text-tertiary)">
                  <th className="px-4 py-2.5 text-left text-[11px] font-medium tracking-[0.05em] uppercase">
                    Varlık
                  </th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-medium tracking-[0.05em] uppercase">
                    Değer
                  </th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-medium tracking-[0.05em] uppercase">
                    Oran / Sıklık
                  </th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-medium tracking-[0.05em] uppercase">
                    Yıllık gelir
                  </th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => {
                  const isStock = a.asset_type === "stock";
                  const div = isStock
                    ? dividendMap.get(a.asset_id)
                    : undefined;
                  const annual = annualFor(a);
                  const isEditing = editingId === a.asset_id;
                  return (
                    <tr
                      key={a.asset_id}
                      className="border-b border-(--color-border-subtle) transition-colors last:border-b-0 hover:bg-(--color-bg-hover)"
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <AssetIcon
                            symbol={a.symbol}
                            iconUrl={a.icon_url}
                            type={a.asset_type}
                            size={28}
                          />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">
                              {a.symbol}
                            </div>
                            <div className="truncate text-xs text-(--color-text-tertiary)">
                              {a.name}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular text-(--color-text-secondary)">
                        {a.market_value_display != null
                          ? formatCurrency(
                              a.market_value_display,
                              displayCurrency,
                              "summary"
                            )
                          : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {isStock ? (
                          <DividendBadge div={div} loading={dividendsLoading} />
                        ) : isEditing ? (
                          <div className="inline-flex items-center gap-1">
                            <input
                              autoFocus
                              inputMode="decimal"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveEdit(a.asset_id);
                                if (e.key === "Escape") cancelEdit();
                              }}
                              placeholder="0.0"
                              className="w-16 rounded-md border border-(--color-border-subtle) bg-(--color-bg-base) px-2 py-1 text-right text-sm tabular outline-none focus:border-(--color-accent)"
                            />
                            <button
                              onClick={() => saveEdit(a.asset_id)}
                              className="rounded p-1 text-(--color-success) hover:bg-(--color-bg-hover)"
                              aria-label="Kaydet"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="rounded p-1 text-(--color-text-tertiary) hover:bg-(--color-bg-hover)"
                              aria-label="İptal"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => startEdit(a)}
                            className="group inline-flex items-center gap-1.5 rounded-md px-2 py-1 tabular transition-colors hover:bg-(--color-bg-hover)"
                          >
                            <span
                              className={cn(
                                a.expected_yield_pct != null
                                  ? "text-(--color-text-primary)"
                                  : "text-(--color-text-tertiary)"
                              )}
                            >
                              {a.expected_yield_pct != null
                                ? `${a.expected_yield_pct.toFixed(2)}%`
                                : "—"}
                            </span>
                            <Pencil className="h-3 w-3 text-(--color-text-tertiary) opacity-0 transition-opacity group-hover:opacity-100" />
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular font-medium text-(--color-accent)">
                        {annual != null
                          ? formatCurrency(annual, displayCurrency, "summary")
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Toplam"
          value={
            stats
              ? formatCurrency(stats.breakdown.total, displayCurrency, "summary")
              : "—"
          }
          loading={loading}
          accent
        />
        <Stat
          label="Staking"
          value={
            stats
              ? formatCurrency(stats.breakdown.staking, displayCurrency, "summary")
              : "—"
          }
          loading={loading}
          color={SOURCE_COLORS.staking}
        />
        <Stat
          label="Temettü"
          value={
            stats
              ? formatCurrency(stats.breakdown.dividend, displayCurrency, "summary")
              : "—"
          }
          loading={loading}
          color={SOURCE_COLORS.dividend}
        />
        <Stat
          label="Faiz"
          value={
            stats
              ? formatCurrency(stats.breakdown.interest, displayCurrency, "summary")
              : "—"
          }
          loading={loading}
          color={SOURCE_COLORS.interest}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <div className="rounded-xl border border-(--color-border-subtle) bg-(--color-bg-panel) p-4">
          <h3 className="mb-3 text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
            Kaynak dağılımı
          </h3>
          <div className="h-56">
            {loading ? (
              <Skeleton className="h-full w-full rounded-full" />
            ) : breakdownData.length === 0 ? (
              <Empty />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={breakdownData}
                    dataKey="value"
                    nameKey="label"
                    innerRadius="55%"
                    outerRadius="80%"
                    paddingAngle={2}
                    stroke="none"
                    isAnimationActive
                    animationDuration={350}
                    animationEasing="ease-out"
                  >
                    {breakdownData.map((d) => (
                      <Cell key={d.source} fill={d.fill} />
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
                    formatter={(v) =>
                      formatCurrency(Number(v), displayCurrency, "summary")
                    }
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-(--color-border-subtle) bg-(--color-bg-panel) p-4">
          <h3 className="mb-3 text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
            Aylık trend
          </h3>
          <div className="h-56">
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-8" />
                <Skeleton className="h-8" />
                <Skeleton className="h-8" />
              </div>
            ) : monthlyData.length === 0 ? (
              <Empty />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyData}>
                  <XAxis
                    dataKey="month"
                    stroke="var(--color-text-tertiary)"
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis
                    stroke="var(--color-text-tertiary)"
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(255,255,255,0.04)" }}
                    contentStyle={{
                      background: "var(--color-bg-panel)",
                      border: "1px solid var(--color-border-subtle)",
                      borderRadius: 8,
                      color: "var(--color-text-primary)",
                      fontSize: 12,
                    }}
                    formatter={(v) =>
                      formatCurrency(Number(v), displayCurrency, "summary")
                    }
                  />
                  <Bar dataKey="value" fill="var(--color-accent)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <div className="text-xs text-(--color-text-tertiary)">
        {stats?.records_count ?? 0} pasif gelir kaydı
      </div>
    </div>
  );
}

/** Hisse temettü sıklık rozeti — Pasif gelir tablosunda "Oran / Sıklık" hücresi. */
function DividendBadge({
  div,
  loading,
}: {
  div: DividendProjection | undefined;
  loading: boolean;
}) {
  if (loading && !div) {
    return <span className="text-xs text-(--color-text-tertiary)">…</span>;
  }
  if (!div || div.frequency === "none") {
    return (
      <span className="text-xs text-(--color-text-tertiary)">Temettü yok</span>
    );
  }
  if (div.frequency === "stopped") {
    return (
      <span
        className="text-xs text-(--color-text-tertiary)"
        title="Son temettü çok eski — şirket ödemeyi kesmiş görünüyor"
      >
        Kesilmiş
      </span>
    );
  }
  return (
    <div className="inline-flex flex-col items-end">
      <span className="rounded bg-(--color-accent)/15 px-1.5 py-0.5 text-[11px] font-medium text-(--color-accent)">
        {FREQ_LABELS[div.frequency] ?? div.frequency}
      </span>
      {div.per_payment > 0 && (
        <span className="mt-0.5 tabular text-[10px] text-(--color-text-tertiary)">
          ≈ {div.per_payment.toFixed(2)} {div.asset_currency}/hisse
        </span>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  loading,
  accent,
  color,
}: {
  label: string;
  value: string;
  loading: boolean;
  accent?: boolean;
  color?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-(--color-border-subtle) bg-(--color-bg-panel) px-4 py-3",
        accent && "border-(--color-accent)/30"
      )}
    >
      <div className="flex items-center gap-1.5">
        {color && (
          <span className="h-2 w-2 rounded-full" style={{ background: color }} />
        )}
        <span className="text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
          {label}
        </span>
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-6 w-24" />
      ) : (
        <div className="mt-1 text-base font-semibold tabular">{value}</div>
      )}
    </div>
  );
}

function Empty() {
  return (
    <div className="grid h-full place-items-center text-center">
      <div>
        <div className="mx-auto mb-3 h-20 w-20 rounded-full border-2 border-dashed border-(--color-border-subtle)" />
        <p className="text-sm text-(--color-text-secondary)">
          Henüz gerçekleşen pasif gelir kaydı yok.
        </p>
        <p className="mt-0.5 text-xs text-(--color-text-tertiary)">
          Üstteki tabloda yıllık % gir — beklenen getiri otomatik hesaplanır.
        </p>
      </div>
    </div>
  );
}
