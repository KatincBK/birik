import { create } from "zustand";
import { api } from "../lib/api";

export type Currency = "USD" | "TRY" | "EUR" | "BTC" | "ETH";
export type RefreshInterval = 1 | 5 | 15;

type SettingsState = {
  displayCurrency: Currency;
  currencyCycle: Currency[];
  soundEnabled: boolean;
  refreshIntervalMin: RefreshInterval;
  autoBackup: boolean;
  /** Boot'ta DB'den yüklendi mi */
  hydrated: boolean;

  hydrate: () => Promise<void>;
  setDisplayCurrency: (c: Currency) => void;
  cycleCurrency: () => void;
  setSoundEnabled: (v: boolean) => void;
  toggleSound: () => void;
  setRefreshInterval: (m: RefreshInterval) => void;
};

/** Setting key sabitleri — backend ile senkron tutuluyor (PLAN §9). */
const KEY = {
  displayCurrency: "display_currency",
  currencyCycle: "currency_cycle",
  soundEnabled: "sound_enabled",
  refreshInterval: "refresh_interval_min",
};

export const useSettingsStore = create<SettingsState>((set, get) => ({
  displayCurrency: "USD",
  currencyCycle: ["USD", "TRY", "EUR"],
  soundEnabled: true,
  refreshIntervalMin: 5,
  autoBackup: true,
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

      set({
        displayCurrency,
        currencyCycle,
        soundEnabled,
        refreshIntervalMin,
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
}));
