import { useEffect } from "react";
import { toast } from "sonner";
import { useUIStore } from "../stores/uiStore";
import { usePortfolioStore } from "../stores/portfolioStore";
import { useAssetStore } from "../stores/assetStore";
import { useStatsStore } from "../stores/statsStore";
import { useSettingsStore } from "../stores/useSettingsStore";

/**
 * PLAN §12 Faz 7 — global klavye kısayolları:
 *   Ctrl+K — Varlık ara/ekle modal'ı (aktif portföye)
 *   Ctrl+N — Aktif view'a göre yeni: dashboard'da varlık, asset detayda işlem
 *   Ctrl+R — Fiyatları yenile
 *   Esc    — Modal kapat (Modal.tsx'te zaten yakalanıyor)
 *
 * Input/textarea/select odaktayken Ctrl+K hariç çoğu shortcut'ı bypass et —
 * kullanıcı yazıyor olabilir.
 */
export function useShortcuts() {
  const view = useUIStore((s) => s.view);
  const openModal = useUIStore((s) => s.openModal);
  const goSettings = useUIStore((s) => s.goSettings);
  const activeId = usePortfolioStore((s) => s.activeId);
  const assetGet = useAssetStore((s) => s.get);
  const refreshLive = useStatsStore((s) => s.refreshLive);
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);

  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      if (!meta) return;
      const target = e.target as HTMLElement | null;
      const inField =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;

      // Ctrl+K — search/add asset (form odakta bile çalışsın)
      if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (activeId == null) {
          toast.info("Önce sol menüden bir portföy seç");
          return;
        }
        const { AddAssetModal } = await import("../components/AddAssetModal");
        openModal(<AddAssetModal portfolioId={activeId} />);
        return;
      }

      if (inField) return;

      // Ctrl+N — view'a göre yeni
      if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        if (view.kind === "asset") {
          const a = assetGet(view.assetId);
          if (a) {
            const { AddTransactionModal } = await import(
              "../components/AddTransactionModal"
            );
            openModal(<AddTransactionModal asset={a} />);
          }
        } else if (view.kind === "dashboard" && activeId != null) {
          const { AddAssetModal } = await import("../components/AddAssetModal");
          openModal(<AddAssetModal portfolioId={activeId} />);
        } else if (view.kind === "alerts") {
          const { CreateAlertModal } = await import(
            "../components/CreateAlertModal"
          );
          openModal(<CreateAlertModal onCreated={() => {}} />);
        } else if (view.kind === "budget") {
          const { CreateBudgetModal } = await import(
            "../components/CreateBudgetModal"
          );
          openModal(<CreateBudgetModal />);
        } else if (view.kind === "home") {
          const { CreatePortfolioModal } = await import(
            "../components/CreatePortfolioModal"
          );
          openModal(<CreatePortfolioModal />);
        }
        return;
      }

      // Ctrl+R — refresh
      if (e.key.toLowerCase() === "r") {
        e.preventDefault();
        try {
          await refreshLive(activeId, displayCurrency);
          toast.success("Yenilendi");
        } catch (err) {
          toast.error("Yenileme başarısız", {
            description: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      // Ctrl+, — Settings (klasik mac/win pattern)
      if (e.key === ",") {
        e.preventDefault();
        goSettings();
        return;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, openModal, activeId, assetGet, refreshLive, displayCurrency, goSettings]);
}
