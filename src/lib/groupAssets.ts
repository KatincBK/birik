import type { AssetStats } from "./api";

/**
 * Aynı sembol+tip altındaki AssetStats listesini tek bir agrega satıra çevirir.
 * - Tek üyeli liste → kopyasını döner (members boş, normal satır gibi davranır)
 * - Çok üyeli liste → ağırlıklı toplamlarla bir grup satırı + members = list
 */
export function aggregateGroup(list: AssetStats[]): AssetStats {
  if (list.length === 1) return { ...list[0] };
  const first = list[0];
  const balance = list.reduce((s, x) => s + x.balance, 0);
  const cost = list.reduce((s, x) => s + x.total_cost_display, 0);
  const mv = list.reduce((s, x) => s + (x.market_value_display ?? 0), 0);
  const pl = list.reduce((s, x) => s + (x.unrealized_pl_display ?? 0), 0);
  const realized = list.reduce((s, x) => s + x.realized_pl_native, 0);
  let yW = 0,
    yT = 0;
  let pW = 0,
    pT = 0;
  for (const x of list) {
    if (x.market_value_display != null) {
      if (x.expected_yield_pct != null) {
        yW += x.market_value_display * x.expected_yield_pct;
        yT += x.market_value_display;
      }
      if (x.price_change_24h_pct != null) {
        pW += x.market_value_display * x.price_change_24h_pct;
        pT += x.market_value_display;
      }
    }
  }
  const platforms = [
    ...new Set(list.flatMap((x) => x.platforms ?? [])),
  ].sort();
  return {
    ...first,
    balance,
    avg_cost: balance > 0 ? cost / balance : 0,
    total_cost_display: cost,
    market_value_display: mv > 0 ? mv : null,
    unrealized_pl_display: list.some((x) => x.unrealized_pl_display != null)
      ? pl
      : null,
    realized_pl_native: realized,
    expected_yield_pct: yT > 0 ? yW / yT : null,
    price_change_24h_pct: pT > 0 ? pW / pT : null,
    platforms,
    members: list,
  };
}

/** symbol|asset_type ile grupla ve aggregate */
export function groupBySymbol(raw: AssetStats[]): AssetStats[] {
  const map = new Map<string, AssetStats[]>();
  for (const a of raw) {
    const key = `${a.symbol}|${a.asset_type}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(a);
  }
  return [...map.values()].map(aggregateGroup);
}
