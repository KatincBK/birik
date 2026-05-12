import { create } from "zustand";
import { api, type PortfolioStats } from "../lib/api";
import { usePortfolioStore } from "./portfolioStore";

/** "Hepsi" konsolide görünümü temsil eden özel id. activeId=null durumu. */
export const ALL_KEY = -1 as const;

/**
 * `statsKey` — UI'dan gelen activeId (number|null) → store kullanılan
 * sayısal anahtar. null → ALL_KEY.
 */
export function statsKey(activeId: number | null): number {
  return activeId == null ? ALL_KEY : activeId;
}

type StatsState = {
  byPortfolio: Record<number, PortfolioStats | null>;
  loading: Record<number, boolean>;
  lastRefresh: Record<number, number | null>;

  recompute: (
    activeId: number | null,
    displayCurrency: string
  ) => Promise<void>;
  refreshLive: (
    activeId: number | null,
    displayCurrency: string
  ) => Promise<void>;
  /** Binance WebSocket tick — bir asset'in fiyatını runtime'da patch'le.
   *  market_value/unrealized_pl da yeniden hesaplanır (display currency
   *  conversion mevcut FX rate'lerle yapılamaz, sadece price_currency==
   *  display_currency ise güncellenir; aksi halde sadece current_price
   *  değişir, kullanıcı yenile'ye basınca tam recompute olur).  */
  applyTick: (assetId: number, price: number, change24hPct: number) => void;
};

/**
 * "Hepsi" için tüm portföyleri tek tek çek + birleştir.
 * Tek portföy stats yapısının semantiğini koruyoruz; portfolio_id=ALL_KEY.
 */
async function calcConsolidated(
  displayCurrency: string,
  force: boolean
): Promise<PortfolioStats> {
  const portfolios = usePortfolioStore.getState().portfolios;

  // Önce hepsi için fiyat refresh'i (force gönderildiyse), sonra hesap
  if (force) {
    await Promise.all(
      portfolios.map((p) => api.refreshAllPrices(p.id, true).catch(() => null))
    );
  }

  const all = await Promise.all(
    portfolios.map((p) => api.calculatePortfolio(p.id, displayCurrency))
  );

  let total_value = 0;
  let total_cost = 0;
  let total_unrealized_pl = 0;
  let assets_missing_price = 0;
  // 24h delta: portföyleri toplarken her birinin total_change_24h değerini topla;
  // pct'yi yeni toplamla hesapla (sum_prev = total_value - total_change_24h).
  let total_change_24h: number | null = null;
  let sum_prev = 0;
  let any_change = false;
  const assets = [];
  for (const s of all) {
    total_value += s.total_value;
    total_cost += s.total_cost;
    total_unrealized_pl += s.total_unrealized_pl;
    assets_missing_price += s.assets_missing_price;
    if (s.total_change_24h != null) {
      total_change_24h = (total_change_24h ?? 0) + s.total_change_24h;
      sum_prev += s.total_value - s.total_change_24h;
      any_change = true;
    }
    assets.push(...s.assets);
  }
  const total_change_24h_pct =
    any_change && sum_prev > 0 && total_change_24h != null
      ? (total_change_24h / sum_prev) * 100
      : null;

  return {
    portfolio_id: ALL_KEY,
    display_currency: displayCurrency,
    total_value,
    total_cost,
    total_unrealized_pl,
    total_change_24h,
    total_change_24h_pct,
    assets,
    assets_missing_price,
  };
}

export const useStatsStore = create<StatsState>((set) => ({
  byPortfolio: {},
  loading: {},
  lastRefresh: {},

  recompute: async (activeId, displayCurrency) => {
    const key = statsKey(activeId);
    set((s) => ({ loading: { ...s.loading, [key]: true } }));
    try {
      const stats =
        activeId == null
          ? await calcConsolidated(displayCurrency, false)
          : await api.calculatePortfolio(activeId, displayCurrency);
      set((s) => ({
        byPortfolio: { ...s.byPortfolio, [key]: stats },
        loading: { ...s.loading, [key]: false },
      }));
    } catch (err) {
      set((s) => ({ loading: { ...s.loading, [key]: false } }));
      throw err;
    }
  },

  applyTick: (assetId, price, change24hPct) => {
    set((s) => {
      // Tüm portföy stats'lerinde bu asset'i bul ve güncelle
      const next: Record<number, PortfolioStats | null> = { ...s.byPortfolio };
      for (const [keyStr, stats] of Object.entries(s.byPortfolio)) {
        if (!stats) continue;
        const idx = stats.assets.findIndex((a) => a.asset_id === assetId);
        if (idx < 0) continue;
        const a = stats.assets[idx];
        // Sadece USD bazlı (Binance hep USD) ve display ya USD ya da
        // FX bridge basit: market_value oranlanır
        const newPrice = price;
        const oldPrice = a.current_price ?? newPrice;
        const ratio = oldPrice > 0 ? newPrice / oldPrice : 1;
        const newAsset = {
          ...a,
          current_price: newPrice,
          price_currency: a.price_currency ?? "USD",
          price_fetched_at: Math.floor(Date.now() / 1000),
          price_change_24h_pct: change24hPct,
          market_value_display:
            a.market_value_display != null
              ? a.market_value_display * ratio
              : null,
          unrealized_pl_display:
            a.market_value_display != null && a.unrealized_pl_display != null
              ? a.market_value_display * ratio - a.total_cost_display
              : a.unrealized_pl_display,
        };
        const newAssets = [...stats.assets];
        newAssets[idx] = newAsset;

        // Toplam yeniden hesapla
        let totalValue = 0;
        let totalUnrealized = 0;
        for (const x of newAssets) {
          if (x.market_value_display != null) totalValue += x.market_value_display;
          if (x.unrealized_pl_display != null) totalUnrealized += x.unrealized_pl_display;
        }

        next[Number(keyStr)] = {
          ...stats,
          assets: newAssets,
          total_value: totalValue,
          total_unrealized_pl: totalUnrealized,
        };
      }
      return { byPortfolio: next };
    });
  },

  refreshLive: async (activeId, displayCurrency) => {
    const key = statsKey(activeId);
    set((s) => ({ loading: { ...s.loading, [key]: true } }));
    try {
      let stats: PortfolioStats;
      if (activeId == null) {
        stats = await calcConsolidated(displayCurrency, true);
      } else {
        await api.refreshAllPrices(activeId, true);
        stats = await api.calculatePortfolio(activeId, displayCurrency);
      }
      set((s) => ({
        byPortfolio: { ...s.byPortfolio, [key]: stats },
        loading: { ...s.loading, [key]: false },
        lastRefresh: {
          ...s.lastRefresh,
          [key]: Math.floor(Date.now() / 1000),
        },
      }));
    } catch (err) {
      set((s) => ({ loading: { ...s.loading, [key]: false } }));
      throw err;
    }
  },
}));
