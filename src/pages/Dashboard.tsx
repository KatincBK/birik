import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Hero } from "../components/dashboard/Hero";
import { AllocationPie } from "../components/dashboard/AllocationPie";
import { AssetTable } from "../components/dashboard/AssetTable";
import { PortfolioTrendChart } from "../components/charts/PortfolioTrendChart";
import { BulkPlatformAssignModal } from "../components/BulkPlatformAssignModal";
import { Skeleton } from "../components/Skeleton";
import { AddAssetModal } from "../components/AddAssetModal";
import { useAssetStore } from "../stores/assetStore";
import { useStatsStore, statsKey } from "../stores/statsStore";
import { usePortfolioStore } from "../stores/portfolioStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useUIStore } from "../stores/uiStore";
import { buttonPrimary } from "../components/Modal";
import { formatChange, changeClass } from "../lib/format";
import type { Asset } from "../lib/api";
import { cn } from "../lib/cn";

const EMPTY_ASSETS: Asset[] = [];

export function Dashboard({ activeId }: { activeId: number | null }) {
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const portfolios = usePortfolioStore((s) => s.portfolios);
  const key = statsKey(activeId);

  const stats = useStatsStore((s) => s.byPortfolio[key] ?? null);
  const recompute = useStatsStore((s) => s.recompute);
  const loading = useStatsStore((s) => s.loading[key] ?? false);

  // Asset listesi: "Hepsi" → tüm portföylerin assets birleşik
  const assetsByPortfolio = useAssetStore((s) => s.byPortfolio);
  const refreshAssets = useAssetStore((s) => s.refresh);

  const assets =
    activeId == null
      ? portfolios.flatMap((p) => assetsByPortfolio[p.id] ?? EMPTY_ASSETS)
      : assetsByPortfolio[activeId] ?? EMPTY_ASSETS;

  const openModal = useUIStore((s) => s.openModal);
  const [allocationMode, setAllocationMode] = useState<"type" | "platform">("type");

  // Asset listelerini fetch'le. "Hepsi" iken hepsi için, tek iken sadece o.
  useEffect(() => {
    if (activeId == null) {
      portfolios.forEach((p) => {
        refreshAssets(p.id).catch(() => {});
      });
    } else {
      refreshAssets(activeId).catch(() => {});
    }
  }, [activeId, portfolios, refreshAssets]);

  // Stats recompute (cache'ten) — display currency veya asset listesi değişince
  useEffect(() => {
    recompute(activeId, displayCurrency).catch(() => {});
  }, [activeId, displayCurrency, assets.length, recompute]);

  const onAddAsset = () => {
    if (activeId == null) {
      // "Hepsi" iken yeni varlık hangi portföye gidecek belirsiz
      toast.info("Önce sol menüden bir portföy seç, sonra varlık ekle");
      return;
    }
    openModal(<AddAssetModal portfolioId={activeId} />);
  };

  if (assets.length === 0 && !loading) {
    return <EmptyState onAdd={onAddAsset} disabled={activeId == null} />;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <header className="flex items-end justify-between gap-6">
        <div className="flex flex-col gap-1.5">
          <Hero totalValue={stats?.total_value ?? 0} loading={loading} />
          {stats?.total_change_24h_pct != null && (
            <div
              className={`inline-flex items-center gap-1.5 text-sm tabular ${changeClass(
                stats.total_change_24h_pct
              )}`}
            >
              <span className="font-medium">
                {stats.total_change_24h_pct > 0 ? "+" : ""}
                {stats.total_change_24h_pct.toFixed(2)}%
              </span>
              <span className="text-(--color-text-tertiary)">·</span>
              <span>
                {stats.total_change_24h != null
                  ? formatChange(stats.total_change_24h, displayCurrency, "summary")
                  : ""}
              </span>
              <span className="text-(--color-text-tertiary)">son 24s</span>
            </div>
          )}
        </div>
        <div className="text-right">
          <span className="text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
            Kar/Zarar (mevcut)
          </span>
          <div
            className={`mt-1 text-2xl font-semibold tabular ${changeClass(
              stats?.total_unrealized_pl ?? 0
            )}`}
          >
            {stats
              ? formatChange(stats.total_unrealized_pl, displayCurrency, "summary")
              : "—"}
          </div>
          {stats && stats.assets_missing_price > 0 && (
            <div className="mt-1 text-[11px] text-(--color-warning)">
              {stats.assets_missing_price} varlığın fiyatı henüz çekilmedi —
              yenile ▲
            </div>
          )}
        </div>
      </header>

      {/* Portföy değer trendi — full width, hero ile pie arası */}
      <PortfolioTrendChart
        portfolioId={activeId}
        displayCurrency={displayCurrency}
      />

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <div className="rounded-xl border border-(--color-border-subtle) bg-(--color-bg-panel) p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
              Dağılım
            </h3>
            <div className="inline-flex gap-0.5 rounded-md border border-(--color-border-subtle) bg-(--color-bg-base) p-0.5">
              {(["type", "platform"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setAllocationMode(m)}
                  className={cn(
                    "rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
                    allocationMode === m
                      ? "border border-(--color-accent)/40 bg-(--color-accent)/15 text-(--color-accent)"
                      : "border border-transparent text-(--color-text-secondary) hover:text-(--color-text-primary)"
                  )}
                >
                  {m === "type" ? "Varlık" : "Platform"}
                </button>
              ))}
            </div>
          </div>
          <div className="h-64">
            {loading && !stats ? (
              <Skeleton className="h-full w-full rounded-full" />
            ) : (
              <AllocationPie
                assets={stats?.assets ?? []}
                displayCurrency={displayCurrency}
                mode={allocationMode}
                onSliceClick={
                  allocationMode === "platform"
                    ? (key: string) =>
                        openModal(
                          <BulkPlatformAssignModal
                            initialPlatform={key === "—" ? undefined : key}
                          />
                        )
                    : undefined
                }
              />
            )}
          </div>
          {allocationMode === "platform" && (
            <button
              onClick={() => openModal(<BulkPlatformAssignModal />)}
              className="mt-3 w-full rounded-md border border-dashed border-(--color-border-subtle) px-3 py-1.5 text-xs text-(--color-text-secondary) transition-colors hover:border-(--color-accent)/40 hover:text-(--color-accent)"
            >
              + Platformları düzenle
            </button>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
              Varlıklar
            </h3>
            <button
              onClick={onAddAsset}
              className={`${buttonPrimary} inline-flex items-center gap-1.5`}
            >
              <Plus className="h-4 w-4" strokeWidth={2.5} />
              Varlık Ekle
            </button>
          </div>
          {loading && !stats ? (
            <div className="space-y-2 rounded-xl border border-(--color-border-subtle) bg-(--color-bg-panel) p-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (
            <AssetTable
              assets={stats?.assets ?? []}
              displayCurrency={displayCurrency}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  onAdd,
  disabled,
}: {
  onAdd: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-(--color-accent)/12 text-(--color-accent)">
          <Plus className="h-6 w-6" strokeWidth={2.25} />
        </div>
        <h2 className="text-2xl font-semibold tracking-tight">
          {disabled
            ? "Önce sol menüden bir portföy seç"
            : "İlk varlığını ekle, dashboard hayata gelsin"}
        </h2>
        <p className="mt-2 text-sm text-(--color-text-secondary)">
          {disabled
            ? "'Hepsi' görünümünde varlık eklenmez — varlık her zaman bir portföye ait."
            : "Kripto, hisse, döviz veya altın — hepsini tek yerden takip et."}
        </p>
        <button
          onClick={onAdd}
          className={`mt-6 inline-flex items-center gap-2 ${buttonPrimary}`}
        >
          <Plus className="h-4 w-4" strokeWidth={2.5} />
          Varlık Ekle
        </button>
      </div>
    </div>
  );
}
