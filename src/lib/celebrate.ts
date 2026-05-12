/**
 * Celebration helpers — canvas-confetti'yi sarmalar.
 *
 * - small: işlem başarıyla eklendi gibi mini olaylar (3 sn, hafif)
 * - goal: hedefe ulaşma — tam ekran burst (PLAN §6.1.E)
 *
 * Renkler markaya uygun: açık mavi brand + success yeşil + amber/mor kategorik.
 */
import confetti from "canvas-confetti";

const PALETTE = ["#6FD3EC", "#8DDDF1", "#10B981", "#F59E0B", "#A78BFA"];

export function celebrateSmall(): void {
  // Sağ alt köşeden hafif yükselen, kısa burst
  confetti({
    particleCount: 30,
    angle: 90,
    spread: 55,
    startVelocity: 35,
    origin: { x: 0.5, y: 0.85 },
    colors: PALETTE,
    ticks: 80,
    scalar: 0.7,
    gravity: 1.0,
    disableForReducedMotion: true,
  });
}

export function celebrateGoal(): void {
  // Tam ekran, multi-stage — soldan ve sağdan + yukarıdan
  const burst = (origin: { x: number; y: number }, count: number) =>
    confetti({
      particleCount: count,
      spread: 80,
      origin,
      colors: PALETTE,
      ticks: 220,
      scalar: 1.1,
      disableForReducedMotion: true,
    });

  burst({ x: 0.2, y: 0.4 }, 60);
  burst({ x: 0.8, y: 0.4 }, 60);
  setTimeout(() => burst({ x: 0.5, y: 0.3 }, 90), 220);
  setTimeout(() => burst({ x: 0.5, y: 0.6 }, 60), 480);
}
