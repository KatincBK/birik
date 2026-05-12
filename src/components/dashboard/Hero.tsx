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
}: {
  totalValue: number;
  loading: boolean;
  label?: string;
  size?: "md" | "lg";
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
        {/* Currency flip — PLAN §6.1.D: Y ekseninde 90° dönüş, 200+200ms */}
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
              loading ? "opacity-60" : "",
            ].join(" ")}
            style={{ transformStyle: "preserve-3d", backfaceVisibility: "hidden" }}
          >
            {formatCurrency(animatedValue, displayCurrency, "summary")}
            <span className="text-sm font-medium text-(--color-text-tertiary) group-hover:text-(--color-text-secondary)">
              {displayCurrency}
            </span>
          </motion.span>
        </AnimatePresence>
      </button>
    </div>
  );
}
