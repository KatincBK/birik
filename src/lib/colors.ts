/**
 * Asset type → kategorik renk paleti.
 *
 * UI'da 4 görünür tip: stock / crypto / commodity / cash.
 * "fx" eski tip — backend'de kalır (eski kayıtlar için), UI'da cash-like
 * çoğunluk fx olduğu için fx artık nakit altında görünür. "commodity"
 * sadece kıymetli metaller için.
 *
 * "cash" gerçek bir asset_type değil — `lib/cashLike.ts::effectiveType()`
 * tarafından türetilen pseudo-tip. UI'da Nakit kategorisi göstermek için.
 */

export type AssetType = "crypto" | "stock" | "fx" | "commodity" | "cash";

export const ASSET_TYPE_COLORS: Record<AssetType, string> = {
  crypto: "#F59E0B", // amber
  stock: "#38BDF8", // sky
  fx: "#FACC15", // emtia ile aynı sarı (eski uyumluluk; cash'e mapping yapılır UI'da)
  commodity: "#FACC15", // yellow / gold
  cash: "#10B981", // emerald — nakit/likit hissi
};

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  crypto: "Kripto",
  stock: "Hisse",
  fx: "Emtia",
  commodity: "Emtia",
  cash: "Nakit",
};

export function assetTypeColor(t: string): string {
  return ASSET_TYPE_COLORS[t as AssetType] ?? "#6B6B75";
}

export function assetTypeLabel(t: string): string {
  return ASSET_TYPE_LABELS[t as AssetType] ?? t;
}
