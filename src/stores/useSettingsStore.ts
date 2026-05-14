import { create } from "zustand";
import { api } from "../lib/api";
import {
  parseExtraSymbols,
  serializeExtraSymbols,
  CASH_EXTRA_KEY,
  COMMODITY_EXTRA_KEY,
} from "../lib/cashLike";

export type Currency = "USD" | "TRY" | "EUR" | "BTC" | "ETH";
export type RefreshInterval = 1 | 5 | 15;

type SettingsState = {
  displayCurrency: Currency;
  currencyCycle: Currency[];
  soundEnabled: boolean;
  refreshIntervalMin: RefreshInterval;
  autoBackup: boolean;
  /** Kullanıcının "Nakit" olarak işaretlediği extra sembol listesi
   *  (DEFAULT_STABLECOINS + fx'in üstüne ek). UPPERCASE. */
  cashExtraSymbols: string[];
  /** Kullanıcının "Emtia" olarak işaretlediği extra sembol listesi
   *  (DEFAULT_COMMODITY_TOKENS'ın üstüne ek). UPPERCASE. */
  commodityExtraSymbols: string[];
  /** Bütçe planlamasında bugünden itibaren kaç ay ileri göstereceğiz. */
  budgetFutureMonths: number;
  /** Gizli mod — toplam değer ve varlık değerleri maskeli gösterilir. */
  valuesHidden: boolean;
  /** Boot'ta DB'den yüklendi mi */
  hydrated: boolean;

  hydrate: () => Promise<void>;
  setDisplayCurrency: (c: Currency) => void;
  cycleCurrency: () => void;
  setSoundEnabled: (v: boolean) => void;
  toggleSound: () => void;
  setRefreshInterval: (m: RefreshInterval) => void;
  addCashSymbol: (sym: string) => void;
  removeCashSymbol: (sym: string) => void;
  addCommoditySymbol: (sym: string) => void;
  removeCommoditySymbol: (sym: string) => void;
  setBudgetFutureMonths: (n: number) => void;
  toggleValuesHidden: () => void;
};

/** Setting key sabitleri — backend ile senkron tutuluyor (PLAN §9). */
const KEY = {
  displayCurrency: "display_currency",
  currencyCycle: "currency_cycle",
  soundEnabled: "sound_enabled",
  refreshInterval: "refresh_interval_min",
  cashExtraSymbols: CASH_EXTRA_KEY,
  commodityExtraSymbols: COMMODITY_EXTRA_KEY,
  budgetFutureMonths: "budget_future_months",
  valuesHidden: "values_hidden",
};

export const useSettingsStore = create<SettingsState>((set, get) => ({
  displayCurrency: "USD",
  currencyCycle: ["USD", "TRY", "EUR"],
  soundEnabled: true,
  refreshIntervalMin: 5,
  autoBackup: true,
  cashExtraSymbols: [],
  commodityExtraSymbols: [],
  budgetFutureMonths: 12,
  valuesHidden: false,
  hydrated: false,

  hydrate: async () => {
    try {
      const list = await api.listSettings();
      const map = new Map(list.map((r) => [r.key, r.value]));

      const displayCurrency =
        (map.get(KEY.displayCurrency) as Currency) ?? "USD";

      let currencyCycle: Currency[] = ["USD", "TRY", "EUR"];
      const raw = map.get(KEY.currencyCycle);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
            currencyCycle = parsed as Currency[];
          }
        } catch {
          /* fall through */
        }
      }

      const soundEnabled = (map.get(KEY.soundEnabled) ?? "true") === "true";
      const refreshIntervalMin =
        (parseInt(map.get(KEY.refreshInterval) ?? "5", 10) as RefreshInterval) || 5;

      const cashExtraSymbols = parseExtraSymbols(
        map.get(KEY.cashExtraSymbols) ?? null
      );
      const commodityExtraSymbols = parseExtraSymbols(
        map.get(KEY.commodityExtraSymbols) ?? null
      );
      const budgetFutureMonths = (() => {
        const raw = map.get(KEY.budgetFutureMonths);
        if (!raw) return 12;
        const n = parseInt(raw, 10);
        return Number.isFinite(n) && n >= 0 && n <= 120 ? n : 12;
      })();

      const valuesHidden = (map.get(KEY.valuesHidden) ?? "false") === "true";

      set({
        displayCurrency,
        currencyCycle,
        soundEnabled,
        refreshIntervalMin,
        cashExtraSymbols,
        commodityExtraSymbols,
        budgetFutureMonths,
        valuesHidden,
        hydrated: true,
      });
    } catch (err) {
      console.warn("[birik] settings hydrate failed", err);
      set({ hydrated: true });
    }
  },

  setDisplayCurrency: (c) => {
    set({ displayCurrency: c });
    api.setSetting(KEY.displayCurrency, c).catch(() => {});
  },
  cycleCurrency: () => {
    const { currencyCycle, displayCurrency } = get();
    const idx = currencyCycle.indexOf(displayCurrency);
    const next = currencyCycle[(idx + 1) % currencyCycle.length];
    set({ displayCurrency: next });
    api.setSetting(KEY.displayCurrency, next).catch(() => {});
  },
  setSoundEnabled: (v) => {
    set({ soundEnabled: v });
    api.setSetting(KEY.soundEnabled, v ? "true" : "false").catch(() => {});
  },
  toggleSound: () => {
    const next = !get().soundEnabled;
    set({ soundEnabled: next });
    api.setSetting(KEY.soundEnabled, next ? "true" : "false").catch(() => {});
  },
  setRefreshInterval: (m) => {
    set({ refreshIntervalMin: m });
    api.setSetting(KEY.refreshInterval, m.toString()).catch(() => {});
  },
  addCashSymbol: (sym) => {
    const clean = sym.trim().toUpperCase();
    if (!clean) return;
    const cur = get().cashExtraSymbols;
    if (cur.includes(clean)) return;
    const next = [...cur, clean].sort();
    set({ cashExtraSymbols: next });
    api.setSetting(KEY.cashExtraSymbols, serializeExtraSymbols(next)).catch(() => {});
  },
  removeCashSymbol: (sym) => {
    const clean = sym.trim().toUpperCase();
    const cur = get().cashExtraSymbols;
    if (!cur.includes(clean)) return;
    const next = cur.filter((s) => s !== clean);
    set({ cashExtraSymbols: next });
    api.setSetting(KEY.cashExtraSymbols, serializeExtraSymbols(next)).catch(() => {});
  },
  addCommoditySymbol: (sym) => {
    const clean = sym.trim().toUpperCase();
    if (!clean) return;
    const cur = get().commodityExtraSymbols;
    if (cur.includes(clean)) return;
    const next = [...cur, clean].sort();
    set({ commodityExtraSymbols: next });
    api
      .setSetting(KEY.commodityExtraSymbols, serializeExtraSymbols(next))
      .catch(() => {});
  },
  removeCommoditySymbol: (sym) => {
    const clean = sym.trim().toUpperCase();
    const cur = get().commodityExtraSymbols;
    if (!cur.includes(clean)) return;
    const next = cur.filter((s) => s !== clean);
    set({ commodityExtraSymbols: next });
    api
      .setSetting(KEY.commodityExtraSymbols, serializeExtraSymbols(next))
      .catch(() => {});
  },
  setBudgetFutureMonths: (n) => {
    const clamped = Math.max(0, Math.min(120, Math.round(n)));
    set({ budgetFutureMonths: clamped });
    api.setSetting(KEY.budgetFutureMonths, clamped.toString()).catch(() => {});
  },
  toggleValuesHidden: () => {
    const next = !get().valuesHidden;
    set({ valuesHidden: next });
    api.setSetting(KEY.valuesHidden, next ? "true" : "false").catch(() => {});
  },
}));
