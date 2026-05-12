import { useEffect } from "react";
import { motion } from "framer-motion";
import { Target } from "lucide-react";
import { useUIStore } from "../stores/uiStore";
import { celebrateGoal } from "../lib/celebrate";
import { playSound } from "../lib/sounds";

/**
 * PLAN §6.1.E — Hedefe ulaşma celebration sahnesi.
 *
 * - 50% siyah overlay 300ms fade-in
 * - Ortada büyük badge (scale 0 → 1.2 → 1, bounce)
 * - "HEDEF! 🎯" + hedef adı + ulaşılan değer
 * - Full ekran confetti
 * - Achievement sesi
 * - 3 sn sonra otomatik kapanır + opsiyonel "Yeni hedef belirle" CTA
 *
 * Faz 6'da goal achievement akışı (check_goal_achievement → trigger)
 * bu component'i `openModal()` ile açacak.
 */
export function CelebrationOverlay({
  goalName,
  achievedLabel,
  ctaLabel,
  onCta,
}: {
  goalName: string;
  achievedLabel: string;
  ctaLabel?: string;
  onCta?: () => void;
}) {
  const closeModal = useUIStore((s) => s.closeModal);

  useEffect(() => {
    // Mount'ta confetti + ses
    playSound("achievement");
    celebrateGoal();
    // 3 sn sonra otomatik kapan
    const t = setTimeout(() => closeModal(), 3000);
    return () => clearTimeout(t);
  }, [closeModal]);

  return (
    <div className="grid place-items-center px-8 py-10 text-center">
      <motion.div
        initial={{ scale: 0, rotate: -10 }}
        animate={{ scale: [0, 1.2, 1], rotate: [- 10, 4, 0] }}
        transition={{
          duration: 0.8,
          times: [0, 0.6, 1],
          ease: [0.16, 1, 0.3, 1],
        }}
        className="grid h-24 w-24 place-items-center rounded-full bg-(--color-accent)/15 text-(--color-accent)"
      >
        <Target className="h-12 w-12" strokeWidth={2.5} />
      </motion.div>

      <motion.h2
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="mt-6 text-4xl font-semibold tracking-tight"
      >
        HEDEF! 🎯
      </motion.h2>

      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.55, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="mt-2 text-base text-(--color-text-primary) tabular"
      >
        {goalName}
      </motion.p>
      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.7, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="mt-1 text-sm text-(--color-text-secondary) tabular"
      >
        {achievedLabel}
      </motion.p>

      {ctaLabel && onCta && (
        <motion.button
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.2, duration: 0.4 }}
          onClick={() => {
            onCta();
            closeModal();
          }}
          className="mt-8 rounded-lg bg-(--color-accent) px-5 py-2.5 text-sm font-medium text-(--color-bg-base) transition-all duration-150 hover:bg-(--color-accent-hover) active:scale-95"
        >
          {ctaLabel}
        </motion.button>
      )}
    </div>
  );
}
