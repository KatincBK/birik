/**
 * Sayı / para / yüzde formatlayıcıları — PLAN §7.
 *
 * İki mod var:
 *   "summary" → dashboard, kart hero (kuruşsuz, K/M kısaltma)
 *   "detail"  → varlık detay, işlem listesi (tam hassasiyet)
 *
 * Sayılar her yerde tabular-nums Tailwind class'ı ile birlikte
 * renderlanmalı (zıplama önleme).
 */

export type FormatMode = "summary" | "detail";

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  TRY: "₺",
  GBP: "£",
  JPY: "¥",
  BTC: "₿",
  ETH: "Ξ",
};

export function currencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency.toUpperCase()] ?? `${currency} `;
}

/**
 * Smart number formatter — PLAN §7.2:
 *   0 < x < 1   : 4 anlamlı hane (ör. 0.0000234)
 *   1 ≤ x < 1k  : 2 ondalık
 *   x ≥ 1k      : virgüllü, 2 ondalık (summary) / tam (detail)
 *   x ≥ 1M ve summary modunda → "1.24M"
 */
export function formatNumber(
  value: number,
  mode: FormatMode = "summary",
  opts: { compact?: boolean; maxFraction?: number } = {}
): string {
  if (!Number.isFinite(value)) return "—";

  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  // Sıfır
  if (abs === 0) return "0";

  // Çok küçük: anlamlı hane
  if (abs > 0 && abs < 1) {
    // 4 anlamlı hane — 0.0000234 gibi
    return sign + abs.toPrecision(4).replace(/\.?0+$/, "");
  }

  // 1k+ summary: K/M/B kısaltma
  const compact = opts.compact ?? mode === "summary";
  if (compact && abs >= 1_000) {
    if (abs >= 1_000_000_000) {
      return sign + (abs / 1_000_000_000).toFixed(2).replace(/\.?0+$/, "") + "B";
    }
    if (abs >= 1_000_000) {
      return sign + (abs / 1_000_000).toFixed(2).replace(/\.?0+$/, "") + "M";
    }
    if (abs >= 10_000) {
      return sign + (abs / 1_000).toFixed(1).replace(/\.?0+$/, "") + "K";
    }
    // 1k - 10k arası tam yaz
  }

  const maxFraction = opts.maxFraction ?? (mode === "detail" ? 8 : 2);
  return (
    sign +
    abs.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: maxFraction,
    })
  );
}

/**
 * Para birimi sembolü ile birlikte formatla.
 * Negatifte sembol başta, eksi öne: -$12.40
 */
export function formatCurrency(
  value: number,
  currency: string,
  mode: FormatMode = "summary"
): string {
  if (!Number.isFinite(value)) return "—";
  const symbol = currencySymbol(currency);
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  return sign + symbol + formatNumber(abs, mode);
}

/** "+5.2%" / "-3.1%" / "0%" — PLAN §7.3 */
export function formatPercent(p: number, fractionDigits = 2): string {
  if (!Number.isFinite(p)) return "—";
  if (Math.abs(p) < 0.0005) return "0%";
  const sign = p > 0 ? "+" : "";
  return `${sign}${p.toFixed(fractionDigits)}%`;
}

/** Mutlak değişim ($+150.20 / $-30.00) */
export function formatChange(
  value: number,
  currency: string,
  mode: FormatMode = "summary"
): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  const symbol = currencySymbol(currency);
  return `${sign}${symbol}${formatNumber(Math.abs(value), mode)}`;
}

/** Renk class'ı: kar/zarar/değişim yok */
export function changeClass(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) < 1e-9)
    return "text-(--color-text-secondary)";
  return value > 0 ? "text-(--color-success)" : "text-(--color-danger)";
}

/** Unix timestamp → "12 Mar 2026" benzeri */
export function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Kısa relative ("2 dk önce", "1 saat önce") */
export function formatRelative(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 30) return "az önce";
  if (diff < 60) return `${diff} sn önce`;
  if (diff < 3600) return `${Math.floor(diff / 60)} dk önce`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} sa önce`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} gün önce`;
  return formatDate(ts);
}
