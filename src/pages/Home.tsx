import { useEffect, useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import {
  Newspaper,
  ExternalLink,
  Wallet,
  PiggyBank,
  TrendingUp,
  Sparkles,
  Target,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Skeleton } from "../components/Skeleton";
import { Hero } from "../components/dashboard/Hero";
import { AssetIcon } from "../components/AssetIcon";
import { CreateBudgetModal } from "../components/CreateBudgetModal";
import { EditTargetModal } from "../components/EditTargetModal";
import { api, type HomeSummary, type PortfolioStats } from "../lib/api";
import { usePortfolioStore } from "../stores/portfolioStore";
import { useBudgetStore } from "../stores/budgetStore";
import { useProfileStore } from "../stores/profileStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useUIStore } from "../stores/uiStore";
import {
  formatCurrency,
  formatChange,
  changeClass,
  formatRelative,
  VALUE_MASK,
} from "../lib/format";
import { cn } from "../lib/cn";

type NewsItem = {
  asset_symbol: string;
  asset_name: string;
  asset_type: string;
  icon_url: string | null;
  headline: string;
  summary: string | null;
  url: string | null;
  source: string | null;
  image: string | null;
  datetime: number;
};

type NewsBundle = {
  asset_symbol: string;
  asset_name: string;
  asset_type: string;
  icon_url: string | null;
  items: {
    headline: string;
    summary: string | null;
    url: string | null;
    source: string | null;
    image: string | null;
    datetime: number;
  }[];
};

const PALETTE = ["#6FD3EC", "#A78BFA", "#F59E0B", "#2DD4BF", "#FB7185", "#FACC15", "#38BDF8"];

export function Home() {
  const portfolios = usePortfolioStore((s) => s.portfolios);
  const setActivePortfolio = usePortfolioStore((s) => s.setActive);
  const goDashboard = useUIStore((s) => s.goDashboard);
  const goBudget = useUIStore((s) => s.goBudget);
  const goPassiveIncome = useUIStore((s) => s.goPassiveIncome);
  const openModal = useUIStore((s) => s.openModal);
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const valuesHidden = useSettingsStore((s) => s.valuesHidden);
  const activeProfileId = useProfileStore((s) => s.activeId);
  const budgets = useBudgetStore((s) => s.budgets);
  const activeBudget = budgets[0] ?? null;

  // Currency-keyed cache: BTC ile USD özet aynı anda hafızada tutulur.
  // Currency değişince eski değer flash etmez — yeni para birimi için cache
  // varsa onu hemen göster, yoksa loading dots.
  const [summaryByCcy, setSummaryByCcy] = useState<Record<string, HomeSummary>>({});
  const [statsByPortfolioByCcy, setStatsByPortfolioByCcy] = useState<
    Record<string, Record<number, PortfolioStats>>
  >({});
  const [loading, setLoading] = useState(true);

  const summary = summaryByCcy[displayCurrency] ?? null;
  const statsByPortfolio = statsByPortfolioByCcy[displayCurrency] ?? {};
  const [news, setNews] = useState<NewsBundle[]>([]);
  const [newsLoading, setNewsLoading] = useState(true);

  // Haberler — sadece aktif profil için
  useEffect(() => {
    if (activeProfileId == null) {
      setNews([]);
      setNewsLoading(false);
      return;
    }
    let cancelled = false;
    setNewsLoading(true);
    api
      .fetchNewsForPortfolios(activeProfileId)
      .then((bundles) => {
        if (!cancelled) setNews(bundles);
      })
      .catch(() => {
        if (!cancelled) setNews([]);
      })
      .finally(() => {
        if (!cancelled) setNewsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProfileId]);

  // Özet + portföy bazlı detay (pasta için)
  useEffect(() => {
    if (activeProfileId == null) {
      setSummaryByCcy({});
      setStatsByPortfolioByCcy({});
      setLoading(false);
      return;
    }
    let cancelled = false;
    // Mevcut currency için cache yoksa loading göster; cache varsa stale-
    // while-revalidate (loading=false, mevcut değeri göster, arkada güncelle).
    const hasCache = summaryByCcy[displayCurrency] != null;
    if (!hasCache) setLoading(true);
    Promise.all([
      api.homeSummary(activeProfileId, displayCurrency),
      Promise.all(
        portfolios.map((p) =>
          api.calculatePortfolio(p.id, displayCurrency).then((s) => [p.id, s] as const)
        )
      ),
    ])
      .then(([s, entries]) => {
        if (cancelled) return;
        setSummaryByCcy((cur) => ({ ...cur, [displayCurrency]: s }));
        const m: Record<number, PortfolioStats> = {};
        for (const [id, st] of entries) m[id] = st;
        setStatsByPortfolioByCcy((cur) => ({ ...cur, [displayCurrency]: m }));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // summaryByCcy değişimini bilerek dep dışında tutuyoruz — re-fetch ihtiyacı
    // displayCurrency / portfolios / activeProfileId değişimlerinde.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProfileId, portfolios, displayCurrency]);

  // Haber feed flat: tüm bundle'ların item'larını süreye göre desc sıralı tek liste
  const newsFlat: NewsItem[] = useMemo(() => {
    const out: NewsItem[] = [];
    for (const b of news) {
      for (const it of b.items) {
        out.push({
          asset_symbol: b.asset_symbol,
          asset_name: b.asset_name,
          asset_type: b.asset_type,
          icon_url: b.icon_url,
          ...it,
        });
      }
    }
    out.sort((a, b) => b.datetime - a.datetime);
    return out.slice(0, 20);
  }, [news]);

  const totalValue = summary?.total_value ?? 0;
  const totalUnrealized = summary?.total_unrealized_pl ?? 0;

  // Pie data — sadece pozitif değerli portföyler
  const pieData = portfolios
    .map((p, idx) => {
      const v = statsByPortfolio[p.id]?.total_value ?? 0;
      return {
        id: p.id,
        name: p.name,
        value: v,
        fill: PALETTE[idx % PALETTE.length],
      };
    })
    .filter((d) => d.value > 0);
  const pieTotal = pieData.reduce((s, d) => s + d.value, 0);

  const onSelectPortfolio = (id: number | null) => {
    setActivePortfolio(id);
    goDashboard();
  };

  const onCardPortfolio = () => onSelectPortfolio(null);
  const onCardCagr = () => onSelectPortfolio(null);
  const onCardMonthly = () => {
    if (activeBudget) {
      goBudget(activeBudget.id);
    } else {
      openModal(<CreateBudgetModal />);
    }
  };
  const onCardPassive = () => goPassiveIncome();
  const onCardTarget = () => {
    if (activeBudget) {
      openModal(<EditTargetModal budget={activeBudget} />);
    } else {
      openModal(<CreateBudgetModal />);
    }
  };

  const showPie = portfolios.length > 1 && pieData.length > 0;

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-10">
      {/* Hero — büyütülmüş */}
      <header className="flex flex-col gap-2">
        <Hero
          totalValue={totalValue}
          loading={loading}
          staleHint={loading || summary == null}
          label="Toplam yönetilen değer"
          size="lg"
        />
        <div className={cn("text-base tabular", changeClass(totalUnrealized))}>
          {valuesHidden
            ? VALUE_MASK
            : formatChange(totalUnrealized, displayCurrency, "summary")}{" "}
          kar/zarar
        </div>
      </header>

      {/* 5 küçük kart — sıralama: portföy, yatırım, getiri, pasif, hedef */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <SummaryCard
          icon={<Wallet className="h-3.5 w-3.5" />}
          label="Mevcut portföy"
          value={
            summary
              ? valuesHidden
                ? VALUE_MASK
                : formatCurrency(summary.total_value, displayCurrency, "summary")
              : "—"
          }
          loading={loading}
          onClick={onCardPortfolio}
        />
        <SummaryCard
          icon={<PiggyBank className="h-3.5 w-3.5" />}
          label="Aylık yatırım"
          value={
            summary?.monthly_investment_avg != null
              ? valuesHidden
                ? VALUE_MASK
                : formatCurrency(
                    summary.monthly_investment_avg,
                    displayCurrency,
                    "summary"
                  )
              : activeBudget
              ? "Veri yok"
              : "Bütçe oluştur"
          }
          loading={loading}
          onClick={onCardMonthly}
          muted={summary?.monthly_investment_avg == null}
        />
        <SummaryCard
          icon={<TrendingUp className="h-3.5 w-3.5" />}
          label="Yıllık getiri"
          value={
            summary?.cagr_pct != null
              ? `${summary.cagr_pct >= 0 ? "+" : ""}${summary.cagr_pct.toFixed(1)}%`
              : "—"
          }
          valueClass={
            summary?.cagr_pct != null
              ? summary.cagr_pct >= 0
                ? "text-(--color-success)"
                : "text-(--color-danger)"
              : ""
          }
          loading={loading}
          onClick={onCardCagr}
        />
        <SummaryCard
          icon={<Sparkles className="h-3.5 w-3.5" />}
          label="Pasif nakit akışı"
          value={
            summary
              ? valuesHidden
                ? `${VALUE_MASK}/yıl`
                : `${formatCurrency(summary.passive_income_annual, displayCurrency, "summary")}/yıl`
              : "—"
          }
          loading={loading}
          onClick={onCardPassive}
        />
        <SummaryCard
          icon={<Target className="h-3.5 w-3.5" />}
          label="Hedef"
          value={
            summary?.target_value != null
              ? valuesHidden
                ? VALUE_MASK
                : formatCurrency(summary.target_value, displayCurrency, "summary")
              : activeBudget
              ? "Hedef belirle"
              : "Bütçe oluştur"
          }
          progress={summary?.target_progress_pct ?? null}
          loading={loading}
          onClick={onCardTarget}
          accent={summary?.target_value != null}
          muted={summary?.target_value == null}
        />
      </div>

      {/* Portföy listesi + pasta */}
      <div
        className={cn(
          "grid gap-6",
          showPie ? "lg:grid-cols-[1fr_320px]" : "grid-cols-1"
        )}
      >
        <div className="space-y-3">
          <h2 className="text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
            Portföyler
          </h2>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ) : (
            <ul className="space-y-2">
              {portfolios.map((p, idx) => {
                const s = statsByPortfolio[p.id];
                const v = s?.total_value ?? 0;
                const pct = totalValue > 0 ? (v / totalValue) * 100 : 0;
                const color = PALETTE[idx % PALETTE.length];
                return (
                  <li key={p.id}>
                    <button
                      onClick={() => onSelectPortfolio(p.id)}
                      className="flex w-full items-center justify-between rounded-xl border border-(--color-border-subtle) bg-(--color-bg-panel) px-4 py-3 text-left transition-colors hover:bg-(--color-bg-hover)"
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className="h-3 w-3 rounded-full"
                          style={{ background: color }}
                        />
                        <div>
                          <div className="text-sm font-medium">{p.name}</div>
                          {portfolios.length > 1 && (
                            <div className="text-xs text-(--color-text-tertiary)">
                              %{pct.toFixed(1)} toplam içinde
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-base font-semibold tabular">
                          {valuesHidden
                            ? VALUE_MASK
                            : formatCurrency(v, displayCurrency, "summary")}
                        </div>
                        {s && (
                          <div
                            className={cn(
                              "text-xs tabular",
                              changeClass(s.total_unrealized_pl)
                            )}
                          >
                            {valuesHidden
                              ? VALUE_MASK
                              : formatChange(
                                  s.total_unrealized_pl,
                                  displayCurrency,
                                  "summary"
                                )}
                          </div>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {showPie && (
          <div className="rounded-xl border border-(--color-border-subtle) bg-(--color-bg-panel) p-4">
            <h3 className="mb-3 text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
              Dağılım
            </h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius="55%"
                    outerRadius="80%"
                    paddingAngle={2}
                    stroke="none"
                    isAnimationActive
                    animationDuration={350}
                    animationEasing="ease-out"
                    onClick={(e: any) =>
                      e?.payload?.id && onSelectPortfolio(e.payload.id)
                    }
                  >
                    {pieData.map((d) => (
                      <Cell key={d.id} fill={d.fill} cursor="pointer" />
                    ))}
                  </Pie>
                  <Tooltip
                    cursor={false}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const p = payload[0].payload as {
                        name: string;
                        value: number;
                        fill: string;
                      };
                      const pct =
                        pieTotal > 0 ? (p.value / pieTotal) * 100 : 0;
                      return (
                        <div className="rounded-lg border border-(--color-border-subtle) bg-(--color-bg-panel) px-3 py-2 text-xs shadow-lg">
                          <div className="flex items-center gap-1.5 font-medium text-(--color-text-primary)">
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ background: p.fill }}
                            />
                            {p.name}
                          </div>
                          <div className="mt-0.5 tabular text-(--color-text-secondary)">
                            {valuesHidden
                              ? VALUE_MASK
                              : formatCurrency(
                                  p.value,
                                  displayCurrency,
                                  "summary"
                                )}
                            <span className="ml-1.5 font-medium text-(--color-accent)">
                              %{pct.toFixed(1)}
                            </span>
                          </div>
                        </div>
                      );
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* Haberler — düz liste, süreye göre */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Newspaper className="h-4 w-4 text-(--color-text-tertiary)" />
          <h2 className="text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
            Haberler
          </h2>
        </div>

        {newsLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : newsFlat.length === 0 ? (
          <div className="rounded-xl border border-dashed border-(--color-border-subtle) bg-(--color-bg-panel)/40 px-5 py-6 text-center">
            <p className="text-sm text-(--color-text-secondary)">
              Hisse haberleri için Finnhub API key gerekiyor.
            </p>
            <p className="mt-1 text-xs text-(--color-text-tertiary)">
              Ayarlar → Veri kaynakları'ndan ekle (ücretsiz).
            </p>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {newsFlat.map((n, i) => (
              <li key={`${n.asset_symbol}-${n.datetime}-${i}`}>
                <button
                  onClick={() => {
                    if (n.url) openUrl(n.url).catch(() => {});
                  }}
                  className="group flex w-full items-start gap-3 rounded-xl border border-(--color-border-subtle) bg-(--color-bg-panel) p-3 text-left transition-colors hover:bg-(--color-bg-hover)"
                >
                  <AssetIcon
                    symbol={n.asset_symbol}
                    iconUrl={n.icon_url}
                    type={n.asset_type}
                    size={36}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm text-(--color-text-primary) group-hover:text-(--color-accent)">
                      {n.headline}
                    </p>
                    <p className="mt-0.5 flex items-center gap-2 text-[11px] text-(--color-text-tertiary)">
                      <span className="font-medium tabular text-(--color-text-secondary)">
                        {n.asset_symbol}
                      </span>
                      <span>•</span>
                      <span>{formatRelative(n.datetime)}</span>
                      {n.url && <ExternalLink className="h-3 w-3" />}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  valueClass,
  loading,
  onClick,
  progress,
  accent,
  muted,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueClass?: string;
  loading: boolean;
  onClick: () => void;
  progress?: number | null;
  accent?: boolean;
  muted?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex flex-col gap-1.5 rounded-xl border border-(--color-border-subtle) bg-(--color-bg-panel) px-3.5 py-3 text-left transition-colors hover:bg-(--color-bg-hover) hover:border-(--color-border-strong)",
        accent && "border-(--color-accent)/30"
      )}
    >
      <div className="flex items-center gap-1.5 text-(--color-text-tertiary) group-hover:text-(--color-text-secondary)">
        {icon}
        <span className="text-[10px] font-medium tracking-[0.05em] uppercase">
          {label}
        </span>
      </div>
      {loading ? (
        <Skeleton className="h-5 w-20" />
      ) : (
        <div
          className={cn(
            "text-base font-semibold tabular",
            muted && "text-(--color-text-tertiary) text-sm font-medium",
            valueClass
          )}
        >
          {value}
        </div>
      )}
      {progress != null && !loading && (
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-(--color-border-subtle)">
          <div
            className="h-full bg-(--color-accent) transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </button>
  );
}
