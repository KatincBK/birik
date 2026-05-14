import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Eye, EyeOff, Settings2 } from "lucide-react";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useUIStore } from "../../stores/uiStore";
import { formatCurrency, VALUE_MASK } from "../../lib/format";
import { useCountUp } from "../../hooks/useCountUp";
import { playSound } from "../../lib/sounds";

export function Hero({
  totalValue,
  loading,
  label = "Toplam değer",
  size = "md",
  /** Henüz değer hesabı bitmemişse true: ufak "güncelleniyor" pulse'u
   *  gösterir, ana değer mevcut/eski haliyle (totalValue=0 ise dash) görünür.
   *  Default false. */
  staleHint = false,
}: {
  totalValue: number;
  loading: boolean;
  label?: string;
  size?: "md" | "lg";
  staleHint?: boolean;
}) {
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const cycle = useSettingsStore((s) => s.cycleCurrency);
  const valuesHidden = useSettingsStore((s) => s.valuesHidden);
  const toggleValuesHidden = useSettingsStore((s) => s.toggleValuesHidden);
  const goSettings = useUIStore((s) => s.goSettings);
  const animatedValue = useCountUp(totalValue, 400);

  // Sağ tık menüsü — toplam değerin üzerinde
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [ctxMenu]);

  const onCycle = () => {
    playSound("click");
    cycle();
  };

  const onToggleHidden = () => {
    playSound("click");
    toggleValuesHidden();
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
          {label}
        </span>
        <button
          onClick={onToggleHidden}
          title={valuesHidden ? "Değerleri göster" : "Değerleri gizle"}
          aria-label={valuesHidden ? "Değerleri göster" : "Değerleri gizle"}
          className="grid h-5 w-5 place-items-center rounded text-(--color-text-tertiary) transition-colors hover:bg-(--color-bg-hover) hover:text-(--color-text-primary)"
        >
          {valuesHidden ? (
            <EyeOff className="h-3.5 w-3.5" />
          ) : (
            <Eye className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
      <button
        onClick={onCycle}
        onContextMenu={onContextMenu}
        title="Para birimi değiştir • Sağ tık: gizle / ayarlar"
        className="group inline-flex items-baseline gap-2 self-start rounded-lg px-1 py-0.5 text-left transition-colors duration-150 hover:bg-(--color-bg-hover)"
        style={{ perspective: "600px" }}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={valuesHidden ? "hidden" : displayCurrency}
            initial={{ rotateY: -90, opacity: 0 }}
            animate={{ rotateY: 0, opacity: 1 }}
            exit={{ rotateY: 90, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className={[
              "inline-flex items-baseline gap-2 font-semibold tracking-tight tabular",
              size === "lg" ? "text-7xl" : "text-5xl",
              loading ? "opacity-85" : "",
            ].join(" ")}
            style={{ transformStyle: "preserve-3d", backfaceVisibility: "hidden" }}
          >
            {valuesHidden
              ? VALUE_MASK
              : formatCurrency(animatedValue, displayCurrency, "summary")}
            <span className="inline-flex items-baseline gap-1.5">
              <span className="text-sm font-medium text-(--color-text-tertiary) group-hover:text-(--color-text-secondary)">
                {displayCurrency}
              </span>
              {staleHint && <UpdatingPulse />}
            </span>
          </motion.span>
        </AnimatePresence>
      </button>

      {ctxMenu && (
        <div
          className="fixed z-50 min-w-[200px] overflow-hidden rounded-lg border border-(--color-border-subtle) bg-(--color-bg-panel) py-1 text-sm shadow-2xl shadow-black/50"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              onToggleHidden();
              setCtxMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-(--color-text-primary) transition-colors hover:bg-(--color-bg-hover)"
          >
            {valuesHidden ? (
              <>
                <Eye className="h-3.5 w-3.5" />
                Değerleri göster
              </>
            ) : (
              <>
                <EyeOff className="h-3.5 w-3.5" />
                Değerleri gizle
              </>
            )}
          </button>
          <button
            onClick={() => {
              goSettings();
              setCtxMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-(--color-text-primary) transition-colors hover:bg-(--color-bg-hover)"
          >
            <Settings2 className="h-3.5 w-3.5" />
            Varlık tipi ayarları
          </button>
        </div>
      )}
    </div>
  );
}

/** Küçük "güncelleniyor" indicator — pulse eden tek nokta. */
function UpdatingPulse() {
  return (
    <motion.span
      animate={{ opacity: [0.3, 1, 0.3] }}
      transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
      className="h-1.5 w-1.5 self-center rounded-full bg-(--color-accent)"
      title="Güncelleniyor…"
    />
  );
}
