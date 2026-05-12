import { useEffect, useRef, useState } from "react";

export type FlashDirection = "up" | "down" | null;

/**
 * Sayısal bir değer değişince yön + flash penceresi döner.
 * Component flash boyunca renkli class uygular, süre sonunda null'a döner.
 *
 * PLAN §6.1.C: fiyat yükselişse yeşil flash 300ms, düşüşse kırmızı.
 */
export function useFlashOnChange(
  value: number | null | undefined,
  duration = 300
): FlashDirection {
  const prev = useRef<number | null | undefined>(value);
  const [direction, setDirection] = useState<FlashDirection>(null);

  useEffect(() => {
    if (value == null || prev.current == null) {
      prev.current = value;
      return;
    }
    if (Math.abs(value - prev.current) < 1e-9) return;

    const dir: FlashDirection = value > prev.current ? "up" : "down";
    setDirection(dir);
    prev.current = value;
    const t = setTimeout(() => setDirection(null), duration);
    return () => clearTimeout(t);
  }, [value, duration]);

  return direction;
}
