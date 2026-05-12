import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { Skeleton } from "./components/Skeleton";
import { ModalSlot } from "./components/Modal";
import { Home } from "./pages/Home";
import { Dashboard } from "./pages/Dashboard";
import { AssetDetail } from "./pages/AssetDetail";
import { Budget } from "./pages/Budget";
import { Investments } from "./pages/Investments";
import { PassiveIncome } from "./pages/PassiveIncome";
import { Alerts } from "./pages/Alerts";
import { Settings } from "./pages/Settings";
import { useDbInit } from "./hooks/useDbInit";
import { useShortcuts } from "./hooks/useShortcuts";
import { useProfileStore } from "./stores/profileStore";
import { usePortfolioStore } from "./stores/portfolioStore";
import { useBudgetStore } from "./stores/budgetStore";
import { useStatsStore } from "./stores/statsStore";
import { useSettingsStore } from "./stores/useSettingsStore";
import { useUIStore } from "./stores/uiStore";

export default function App() {
  const db = useDbInit();
  const refreshProfiles = useProfileStore((s) => s.refresh);
  const activeProfileId = useProfileStore((s) => s.activeId);
  const refreshPortfolios = usePortfolioStore((s) => s.refresh);
  const refreshBudgets = useBudgetStore((s) => s.refresh);
  const hydrateSettings = useSettingsStore((s) => s.hydrate);
  const portfolios = usePortfolioStore((s) => s.portfolios);
  const budgets = useBudgetStore((s) => s.budgets);
  const activeId = usePortfolioStore((s) => s.activeId);
  const view = useUIStore((s) => s.view);

  useShortcuts();

  // Boot: settings + profiles
  useEffect(() => {
    if (db.status === "ready") {
      hydrateSettings().catch(() => {});
      refreshProfiles().catch(() => {});
    }
  }, [db.status, hydrateSettings, refreshProfiles]);

  // Aktif profil değiştiğinde portföy + bütçe listelerini yenile
  useEffect(() => {
    if (db.status !== "ready" || activeProfileId == null) return;
    refreshPortfolios(activeProfileId).catch(() => {});
    refreshBudgets(activeProfileId).catch(() => {});
  }, [db.status, activeProfileId, refreshPortfolios, refreshBudgets]);

  // Binance WebSocket tick listener — kripto fiyatları canlı akar
  useEffect(() => {
    if (db.status !== "ready") return;
    const applyTick = useStatsStore.getState().applyTick;
    const unlisten = listen<{
      asset_id: number;
      symbol: string;
      price: number;
      change_24h_pct: number;
      currency: string;
    }>("price_tick", (event) => {
      const { asset_id, price, change_24h_pct } = event.payload;
      applyTick(asset_id, price, change_24h_pct);
    });
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [db.status]);

  const activePortfolio =
    activeId == null ? null : portfolios.find((p) => p.id === activeId) ?? null;

  let title = "Birik";
  if (view.kind === "home") {
    title = "Anasayfa";
  } else if (view.kind === "dashboard") {
    title = activeId == null ? "Hepsi" : activePortfolio?.name ?? "Birik";
  } else if (view.kind === "asset") {
    title = "Varlık detayı";
  } else if (view.kind === "budget") {
    const b = budgets.find((x) => x.id === view.budgetId);
    title = b?.name ?? "Bütçe";
  } else if (view.kind === "investments") {
    title = "Yatırım";
  } else if (view.kind === "passiveIncome") {
    title = "Nakit akışları";
  } else if (view.kind === "alerts") {
    title = "Alarmlar";
  } else if (view.kind === "settings") {
    title = "Ayarlar";
  }

  // App ready: db + profil yüklendi (portföy boş olabilir, anasayfa gösterir)
  const isReady = db.status === "ready" && activeProfileId != null;

  return (
    <div className="flex h-screen w-screen bg-(--color-bg-base) text-(--color-text-primary)">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar activeId={activeId} title={title} />
        <main className="flex-1 overflow-y-auto">
          {!isReady ? (
            <BootSkeleton />
          ) : view.kind === "home" ? (
            <Home />
          ) : view.kind === "dashboard" ? (
            <Dashboard activeId={activeId} />
          ) : view.kind === "asset" ? (
            <AssetDetail assetId={view.assetId} />
          ) : view.kind === "budget" ? (
            <Budget budgetId={view.budgetId} />
          ) : view.kind === "investments" ? (
            <Investments />
          ) : view.kind === "passiveIncome" ? (
            <PassiveIncome />
          ) : view.kind === "alerts" ? (
            <Alerts />
          ) : (
            <Settings />
          )}
        </main>
      </div>

      <ModalSlot />
    </div>
  );
}

function BootSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-6 py-12">
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-5 w-1/3" />
      <div className="mt-8 space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-4/6" />
      </div>
    </div>
  );
}
