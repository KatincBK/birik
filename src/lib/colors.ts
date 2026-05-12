/**
 * Asset type → kategorik renk paleti.
 *
 * UI'da 3 görünür tip: stock / crypto / commodity. "fx" eski tip — backend'de
 * kalır (eski kayıtlar için), UI'da "commodity" altına birleşik (USD, EUR, XAU
 * vs. hepsi emtia başlığı altında).
 */

export type AssetType = "crypto" | "stock" | "fx" | "commodity";

export const ASSET_TYPE_COLORS: Record<AssetType, string> = {
  crypto: "#F59E0B", // amber
  stock: "#38BDF8", // sky
  fx: "#FACC15", // emtia ile aynı sarı (UI'da birleşik)
  commodity: "#FACC15", // yellow / gold
};

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  crypto: "Kripto",
  stock: "Hisse",
  fx: "Emtia",
  commodity: "Emtia",
};

export function assetTypeColor(t: string): string {
  return ASSET_TYPE_COLORS[t as AssetType] ?? "#6B6B75";
}

export function assetTypeLabel(t: string): string {
  return ASSET_TYPE_LABELS[t as AssetType] ?? t;
}
