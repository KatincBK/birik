import { create } from "zustand";
import { api, type Budget } from "../lib/api";

type BudgetState = {
  budgets: Budget[];
  activeId: number | null;
  loading: boolean;

  refresh: (profileId?: number | null) => Promise<void>;
  setActive: (id: number | null) => void;
  create: (args: Parameters<typeof api.createBudget>[0]) => Promise<Budget>;
  update: (args: Parameters<typeof api.updateBudget>[0]) => Promise<Budget>;
  remove: (id: number) => Promise<void>;
  setPinned: (id: number, pinned: boolean) => Promise<void>;
};

export const useBudgetStore = create<BudgetState>((set, get) => ({
  budgets: [],
  activeId: null,
  loading: false,

  refresh: async (profileId = null) => {
    set({ loading: true });
    try {
      const list = await api.listBudgets(profileId);
      set({ budgets: list, loading: false });
      const { activeId } = get();
      if (activeId != null && !list.find((b) => b.id === activeId)) {
        set({ activeId: null });
      }
    } catch (err) {
      set({ loading: false });
      throw err;
    }
  },

  setActive: (id) => set({ activeId: id }),

  create: async (args) => {
    const b = await api.createBudget(args);
    set((s) => ({ budgets: [...s.budgets, b].sort((a, b) => b.pinned - a.pinned || a.id - b.id) }));
    return b;
  },

  update: async (args) => {
    const b = await api.updateBudget(args);
    set((s) => ({
      budgets: s.budgets
        .map((x) => (x.id === b.id ? b : x))
        .sort((a, b) => b.pinned - a.pinned || a.id - b.id),
    }));
    return b;
  },

  remove: async (id) => {
    await api.deleteBudget(id);
    set((s) => ({
      budgets: s.budgets.filter((x) => x.id !== id),
      activeId: s.activeId === id ? null : s.activeId,
    }));
  },

  setPinned: async (id, pinned) => {
    await api.setBudgetPin(id, pinned);
    set((s) => ({
      budgets: s.budgets
        .map((x) => (x.id === id ? { ...x, pinned: pinned ? 1 : 0 } : x))
        .sort((a, b) => b.pinned - a.pinned || a.id - b.id),
    }));
  },
}));
