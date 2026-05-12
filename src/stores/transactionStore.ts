import { create } from "zustand";
import { api, type Transaction } from "../lib/api";

type TxState = {
  byAsset: Record<number, Transaction[]>;
  loading: Record<number, boolean>;

  refresh: (assetId: number) => Promise<void>;
  create: (args: Parameters<typeof api.createTransaction>[0]) => Promise<Transaction>;
  softDelete: (id: number, assetId: number) => Promise<void>;
  hardDelete: (id: number, assetId: number) => Promise<void>;
  restore: (id: number, assetId: number) => Promise<void>;
};

export const useTransactionStore = create<TxState>((set) => ({
  byAsset: {},
  loading: {},

  refresh: async (assetId) => {
    set((s) => ({ loading: { ...s.loading, [assetId]: true } }));
    try {
      const list = await api.listTransactions(assetId, false);
      set((s) => ({
        byAsset: { ...s.byAsset, [assetId]: list },
        loading: { ...s.loading, [assetId]: false },
      }));
    } catch (err) {
      set((s) => ({ loading: { ...s.loading, [assetId]: false } }));
      throw err;
    }
  },

  create: async (args) => {
    const t = await api.createTransaction(args);
    set((s) => ({
      byAsset: {
        ...s.byAsset,
        [args.assetId]: [t, ...(s.byAsset[args.assetId] ?? [])],
      },
    }));
    return t;
  },

  softDelete: async (id, assetId) => {
    await api.softDeleteTransaction(id);
    set((s) => ({
      byAsset: {
        ...s.byAsset,
        [assetId]: (s.byAsset[assetId] ?? []).filter((t) => t.id !== id),
      },
    }));
  },

  hardDelete: async (id, assetId) => {
    await api.hardDeleteTransaction(id);
    set((s) => ({
      byAsset: {
        ...s.byAsset,
        [assetId]: (s.byAsset[assetId] ?? []).filter((t) => t.id !== id),
      },
    }));
  },

  restore: async (id, assetId) => {
    await api.restoreTransaction(id);
    // Restore'da sadece tek satır geri geliyor — basitlik için tüm listeyi yenile
    const list = await api.listTransactions(assetId, false);
    set((s) => ({ byAsset: { ...s.byAsset, [assetId]: list } }));
  },
}));
