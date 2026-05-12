import { useEffect, useRef, useState } from "react";

/**
 * Hedef sayıya doğru rAF tabanlı interpolasyon — PLAN §6.1 sayı animasyonu.
 *
 * Easing: cubic-bezier(0.16, 1, 0.3, 1)'i `1 - (1-t)^4` ile yaklaşık —
 * fark eden değil, görsel olarak Apple'ın "smooth out" eğrisinin aynısı.
 * Default 400ms (PLAN §4.4 "yavaş — sayı animasyonu").
 *
 * `target` çok ufak değişimde (eps eşiği altı) animasyon yapmaz —
 * her render'da gereksiz tick'lerden kaçın.
 */
export function useCountUp(target: number, duration = 400): number {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!Number.isFinite(target)) {
      setDisplay(target);
      return;
    }
    const from = fromRef.current;
    if (Math.abs(from - target) < 0.0005) {
      fromRef.current = target;
      setDisplay(target);
      return;
    }

    const start = performance.now();
    const ease = (t: number) => 1 - Math.pow(1 - t, 4);

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const v = from + (target - from) * ease(t);
      setDisplay(v);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      // İptal anındaki değeri start point yap — flash sırasında değişim
      // gelirse oradan devam etsin, başa sarmasın.
      fromRef.current = display;
    };
    // display'i deliberately deps dışı tutuyoruz — yoksa her tick yeni
    // animasyon tetikler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration]);

  return display;
}
