/**
 * UI tarafında türetilen efektif tip (cash / commodity).
 *
 * Schema değişmez — gerçek `asset_type` (crypto/stock/fx/commodity) DB'de saklı.
 * UI bunun üstüne "ekonomik anlam" katar:
 *   - Stablecoin'ler + fiat para birimleri → "Nakit"
 *   - Tokenize altın (PAXG, XAUT…) → "Emtia" (kripto görünmesinler)
 *   - Kullanıcı Ayarlar'dan kendi sembollerini ekler.
 */

import type { Asset, AssetStats } from "./api";

/** Sabit varsayılan stablecoin listesi. */
export const DEFAULT_STABLECOINS = [
  "USDT",
  "USDC",
  "DAI",
  "FDUSD",
  "TUSD",
  "USDP",
  "PYUSD",
  "BUSD",
  "USDD",
  "GUSD",
  "FRAX",
  "LUSD",
] as const;

/** Sabit varsayılan tokenize emtia (altın/gümüş) listesi. */
export const DEFAULT_COMMODITY_TOKENS = [
  "PAXG", // Paxos Gold
  "XAUT", // Tether Gold
  "KAU", // Kinesis Gold (1 gram)
  "KAG", // Kinesis Silver (1 ons)
  "DGLD", // Digital Gold Token
  "AGX", // Silver Token
] as const;

/** localStorage / settings key — kullanıcı extra sembolleri JSON array olarak tutar. */
export const CASH_EXTRA_KEY = "cash_extra_symbols";
export const COMMODITY_EXTRA_KEY = "commodity_extra_symbols";

export function parseExtraSymbols(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim().toUpperCase())
        .filter(Boolean);
    }
  } catch {
    /* yutuluyor */
  }
  return [];
}

export function serializeExtraSymbols(list: string[]): string {
  const cleaned = Array.from(
    new Set(list.map((s) => s.trim().toUpperCase()).filter(Boolean))
  );
  return JSON.stringify(cleaned);
}

/** Sembol + tip'ten nakit mi? Sabit liste + kullanıcı listesi birleşimi. */
export function isCashLikeSymbol(
  symbol: string,
  assetType: string,
  extraSymbols: string[] = []
): boolean {
  const sym = symbol.toUpperCase();
  // Tüm fiat para birimleri (fx) nakit
  if (assetType === "fx") return true;
  // Sabit stablecoin listesi
  if ((DEFAULT_STABLECOINS as readonly string[]).includes(sym)) return true;
  // Kullanıcının extra listesinden
  if (extraSymbols.includes(sym)) return true;
  return false;
}

/** Sembolden tokenize emtia mı (altın/gümüş kripto). asset_type ne olursa olsun. */
export function isCommodityLikeSymbol(
  symbol: string,
  extraSymbols: string[] = []
): boolean {
  const sym = symbol.toUpperCase();
  if ((DEFAULT_COMMODITY_TOKENS as readonly string[]).includes(sym)) return true;
  if (extraSymbols.includes(sym)) return true;
  return false;
}

/** Asset veya AssetStats'tan UI efektif tip. Öncelik sırası:
 *  1. cash override   (stablecoin / fiat / kullanıcı cash listesi)
 *  2. commodity override (tokenize altın/gümüş / kullanıcı commodity listesi)
 *  3. gerçek asset_type
 */
export function effectiveType(
  asset: { symbol: string; asset_type?: string; type?: string },
  cashExtra: string[] = [],
  commodityExtra: string[] = []
): string {
  const t = asset.asset_type ?? asset.type ?? "";
  if (isCashLikeSymbol(asset.symbol, t, cashExtra)) return "cash";
  if (isCommodityLikeSymbol(asset.symbol, commodityExtra)) return "commodity";
  return t;
}

export function isCashLike(
  a: Asset | AssetStats,
  extraSymbols: string[] = []
): boolean {
  const t = "asset_type" in a ? a.asset_type : a.type;
  return isCashLikeSymbol(a.symbol, t, extraSymbols);
}
