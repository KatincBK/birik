import { AnimatePresence, motion } from "framer-motion";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { formatCurrency } from "../../lib/format";
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
  const animatedValue = useCountUp(totalValue, 400);

  const onCycle = () => {
    playSound("click");
    cycle();
  };

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
        {label}
      </span>
      <button
        onClick={onCycle}
        title="Para birimi değiştir"
        className="group inline-flex items-baseline gap-2 self-start rounded-lg px-1 py-0.5 text-left transition-colors duration-150 hover:bg-(--color-bg-hover)"
        style={{ perspective: "600px" }}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={displayCurrency}
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
            {formatCurrency(animatedValue, displayCurrency, "summary")}
            <span className="inline-flex items-baseline gap-1.5">
              <span className="text-sm font-medium text-(--color-text-tertiary) group-hover:text-(--color-text-secondary)">
                {displayCurrency}
              </span>
              {staleHint && <UpdatingPulse />}
            </span>
          </motion.span>
        </AnimatePresence>
      </button>
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
