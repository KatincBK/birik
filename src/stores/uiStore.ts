import { create } from "zustand";
import type { ReactNode } from "react";

export type View =
  | { kind: "home" }
  | { kind: "dashboard" }
  | { kind: "asset"; assetId: number }
  | { kind: "budget"; budgetId: number }
  | { kind: "investments" }
  | { kind: "passiveIncome" }
  | { kind: "alerts" }
  | { kind: "settings" };

type UIState = {
  view: View;
  setView: (v: View) => void;
  goDashboard: () => void;
  goAsset: (assetId: number) => void;
  goHome: () => void;
  goBudget: (budgetId: number) => void;
  goInvestments: () => void;
  goPassiveIncome: () => void;
  goAlerts: () => void;
  goSettings: () => void;

  /**
   * Modal slot — tek seferde tek modal. ReactNode olarak tutuyoruz,
   * sayfa-seviyesi component bunu render eder. Kapanma kontrolü
   * modal'ın kendisinde (close fonksiyonu null set eder).
   */
  modal: ReactNode | null;
  openModal: (node: ReactNode) => void;
  closeModal: () => void;
};

export const useUIStore = create<UIState>((set) => ({
  view: { kind: "home" },
  setView: (view) => set({ view }),
  goHome: () => set({ view: { kind: "home" } }),
  goDashboard: () => set({ view: { kind: "dashboard" } }),
  goAsset: (assetId) => set({ view: { kind: "asset", assetId } }),
  goBudget: (budgetId) => set({ view: { kind: "budget", budgetId } }),
  goInvestments: () => set({ view: { kind: "investments" } }),
  goPassiveIncome: () => set({ view: { kind: "passiveIncome" } }),
  goAlerts: () => set({ view: { kind: "alerts" } }),
  goSettings: () => set({ view: { kind: "settings" } }),

  modal: null,
  openModal: (node) => set({ modal: node }),
  closeModal: () => set({ modal: null }),
}));
