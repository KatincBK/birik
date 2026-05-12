import { create } from "zustand";
import { api, type Asset } from "../lib/api";

type AssetState = {
  byPortfolio: Record<number, Asset[]>;
  loading: Record<number, boolean>;

  refresh: (portfolioId: number) => Promise<void>;
  create: (args: Parameters<typeof api.createAsset>[0]) => Promise<Asset>;
  remove: (id: number, portfolioId: number) => Promise<void>;
  /** Cache lookup */
  get: (id: number) => Asset | null;
};

export const useAssetStore = create<AssetState>((set, get) => ({
  byPortfolio: {},
  loading: {},

  refresh: async (portfolioId) => {
    set((s) => ({ loading: { ...s.loading, [portfolioId]: true } }));
    try {
      const list = await api.listAssets(portfolioId);
      set((s) => ({
        byPortfolio: { ...s.byPortfolio, [portfolioId]: list },
        loading: { ...s.loading, [portfolioId]: false },
      }));
    } catch (err) {
      set((s) => ({ loading: { ...s.loading, [portfolioId]: false } }));
      throw err;
    }
  },

  create: async (args) => {
    const a = await api.createAsset(args);
    set((s) => ({
      byPortfolio: {
        ...s.byPortfolio,
        [args.portfolioId]: [...(s.byPortfolio[args.portfolioId] ?? []), a],
      },
    }));
    return a;
  },

  remove: async (id, portfolioId) => {
    await api.deleteAsset(id);
    set((s) => ({
      byPortfolio: {
        ...s.byPortfolio,
        [portfolioId]: (s.byPortfolio[portfolioId] ?? []).filter((a) => a.id !== id),
      },
    }));
  },

  get: (id) => {
    const all = Object.values(get().byPortfolio).flat();
    return all.find((a) => a.id === id) ?? null;
  },
}));
