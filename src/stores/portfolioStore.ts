import { create } from "zustand";
import { api, type Portfolio } from "../lib/api";

type PortfolioState = {
  portfolios: Portfolio[];
  /** null = "Hepsi" konsolide görünüm. */
  activeId: number | null;
  loading: boolean;
  error: string | null;

  /** Profile-aware refresh. Boş ise tüm profillerden çeker (eski "Hepsi" davranışı). */
  refresh: (profileId?: number | null) => Promise<void>;
  setActive: (id: number | null) => void;
  create: (name: string, profileId: number) => Promise<Portfolio>;
  remove: (id: number) => Promise<void>;
  setPinned: (id: number, pinned: boolean) => Promise<void>;
  rename: (id: number, name: string) => Promise<void>;
};

export const usePortfolioStore = create<PortfolioState>((set) => ({
  portfolios: [],
  activeId: null,
  loading: false,
  error: null,

  refresh: async (profileId = null) => {
    set({ loading: true, error: null });
    try {
      const list = await api.listPortfolios(profileId);
      set((s) => ({
        portfolios: list,
        loading: false,
        // Aktif id mevcut listede yoksa ilkine düş; "Hepsi" (null) korunur
        activeId:
          s.activeId == null
            ? null
            : list.find((p) => p.id === s.activeId)
            ? s.activeId
            : list[0]?.id ?? null,
      }));
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  },

  setActive: (id) => set({ activeId: id }),

  create: async (name, profileId) => {
    const p = await api.createPortfolio(name, profileId);
    set((s) => ({ portfolios: [...s.portfolios, p] }));
    return p;
  },

  remove: async (id) => {
    await api.deletePortfolio(id);
    set((s) => {
      const next = s.portfolios.filter((p) => p.id !== id);
      const activeId = s.activeId === id ? null : s.activeId;
      return { portfolios: next, activeId };
    });
  },

  setPinned: async (id, pinned) => {
    await api.setPortfolioPin(id, pinned);
    set((s) => ({
      portfolios: s.portfolios
        .map((p) => (p.id === id ? { ...p, pinned: pinned ? 1 : 0 } : p))
        .sort((a, b) => b.pinned - a.pinned || a.id - b.id),
    }));
  },

  rename: async (id, name) => {
    await api.renamePortfolio(id, name);
    set((s) => ({
      portfolios: s.portfolios.map((p) => (p.id === id ? { ...p, name } : p)),
    }));
  },
}));

/** Aktif portföyü dönen helper hook. Yoksa null. */
export function useActivePortfolio() {
  return usePortfolioStore((s) =>
    s.activeId == null
      ? null
      : s.portfolios.find((p) => p.id === s.activeId) ?? null
  );
}
