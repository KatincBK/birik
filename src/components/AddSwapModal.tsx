import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeftRight,
  Search,
  Plus,
  X,
  Trash2,
  ChevronDown,
  Wallet,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import {
  ModalShell,
  inputClass,
  buttonPrimary,
  buttonGhost,
} from "./Modal";
import { Skeleton } from "./Skeleton";
import { AssetIcon } from "./AssetIcon";
import { api, type Asset, type SwapSellLeg, type SwapBuyLeg } from "../lib/api";
import { useUIStore } from "../stores/uiStore";
import { useAssetStore } from "../stores/assetStore";
import { useStatsStore } from "../stores/statsStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useDebounce } from "../hooks/useDebounce";
import { formatCurrency } from "../lib/format";
import { cn } from "../lib/cn";
import { playSound } from "../lib/sounds";
import { celebrateSmall } from "../lib/celebrate";

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

let _legCounter = 0;
const newUid = () => `leg-${++_legCounter}-${Date.now()}`;

function todayLocalDateInput(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}
function dateInputToUnix(s: string): number {
  return Math.floor(new Date(s + "T00:00:00").getTime() / 1000);
}
function parseDecimal(raw: string): number {
  const s = raw.replace(/\s/g, "").replace(",", ".");
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : NaN;
}
/** Input'a yazılacak temiz sayı string'i — float artığı temizler. */
function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "";
  if (n === 0) return "0";
  return parseFloat(n.toPrecision(10)).toString();
}
/** TRY-pivot dönüşüm — calc.rs::convert mantığı. rates: currency→TRY. */
function convertViaTry(
  amount: number,
  from: string,
  to: string,
  rates: Record<string, number> | null
): number {
  if (from.toUpperCase() === to.toUpperCase()) return amount;
  if (!rates) return amount;
  const toTry = (c: string) =>
    c.toUpperCase() === "TRY" ? 1 : rates[c.toUpperCase()] ?? 0;
  const f = toTry(from);
  const t = toTry(to);
  if (f === 0 || t === 0) return amount;
  return (amount * f) / t;
}

/* ------------------------------------------------------------------ */
/* Tipler                                                             */
/* ------------------------------------------------------------------ */

/** Portföydeki bir (asset, platform) kombinasyonu — net qty > 0. */
type Holding = {
  key: string; // `${assetId}|${platform ?? ""}`
  assetId: number;
  symbol: string;
  name: string;
  assetType: Asset["type"];
  currency: string;
  iconUrl: string | null;
  platform: string | null;
  netQty: number;
  cachedPrice: number | null;
};

type SellLeg = {
  uid: string;
  holdingKey: string; // "" = henüz seçilmedi
  quantity: string;
  price: string;
};

/** Alınan bacakta seçilen sembol. */
type PickedSymbol = {
  symbol: string;
  name: string;
  assetType: Asset["type"];
  currency: string;
  externalId: string | null;
  iconUrl: string | null;
  existingAssetId: number | null;
};

type BuyLeg = {
  uid: string;
  picked: PickedSymbol | null;
  platform: string;
  quantity: string;
  price: string;
  priceTouched: boolean;
  /** Yıllık beklenen getiri (staking/faiz/temettü) — opsiyonel, asset düzeyinde */
  yieldPct: string;
};

type SearchHit = {
  external_id: string;
  symbol: string;
  name: string;
  icon: string | null;
  asset_type: string;
  exchange: string | null;
  market_cap_rank: number | null;
};

const blankSell = (): SellLeg => ({
  uid: newUid(),
  holdingKey: "",
  quantity: "",
  price: "",
});
const blankBuy = (): BuyLeg => ({
  uid: newUid(),
  picked: null,
  platform: "",
  quantity: "",
  price: "",
  priceTouched: false,
  yieldPct: "",
});

/* ------------------------------------------------------------------ */
/* Ana modal                                                          */
/* ------------------------------------------------------------------ */

/**
 * Çok bacaklı takas işlemi: N satılan + M alınan varlık tek atomik kayıt.
 * Satılan bacaklar portföy holdings'inden seçilir; alınan bacaklar sembol
 * aramasından (portföydeki eşleşenler önce). Alınan varlığın birim maliyeti
 * satılan toplam değer / alınan toplam miktar ile otomatik hesaplanır,
 * kullanıcı override edebilir.
 */
export function AddSwapModal({ portfolioId }: { portfolioId: number }) {
  const closeModal = useUIStore((s) => s.closeModal);
  const refreshAssets = useAssetStore((s) => s.refresh);
  const recompute = useStatsStore((s) => s.recompute);
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);

  const [loading, setLoading] = useState(true);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [portfolioAssets, setPortfolioAssets] = useState<Asset[]>([]);
  const [rates, setRates] = useState<Record<string, number> | null>(null);

  const [date, setDate] = useState(todayLocalDateInput());
  const [note, setNote] = useState("");
  const [sellLegs, setSellLegs] = useState<SellLeg[]>(() => [blankSell()]);
  const [buyLegs, setBuyLegs] = useState<BuyLeg[]>(() => [blankBuy()]);
  const [submitting, setSubmitting] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);

  /* --- Holdings + fx yükle --- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [assets, fx] = await Promise.all([
          api.listAssets(portfolioId),
          api.fetchFxRates().catch(() => null),
        ]);
        if (cancelled) return;
        setPortfolioAssets(assets);
        setRates(fx?.rates ?? null);

        const perAsset = await Promise.all(
          assets.map(async (a) => {
            const [txs, cached] = await Promise.all([
              api.listTransactions(a.id, false).catch(() => []),
              api.getCachedPrice(a.id).catch(() => null),
            ]);
            return { a, txs, cached };
          })
        );
        if (cancelled) return;

        const hs: Holding[] = [];
        for (const { a, txs, cached } of perAsset) {
          // Platform bazında net qty — calc.rs::per_platform ile aynı mantık
          const map = new Map<string, number>();
          for (const t of txs) {
            const plat = (t.platform ?? "").trim();
            const delta = t.type === "sell" ? -t.quantity : t.quantity;
            map.set(plat, (map.get(plat) ?? 0) + delta);
          }
          for (const [plat, qty] of map) {
            if (qty > 1e-9) {
              hs.push({
                key: `${a.id}|${plat}`,
                assetId: a.id,
                symbol: a.symbol,
                name: a.name,
                assetType: a.type,
                currency: a.currency,
                iconUrl: a.icon_url,
                platform: plat || null,
                netQty: qty,
                cachedPrice: cached?.price ?? null,
              });
            }
          }
        }
        hs.sort(
          (x, y) =>
            x.symbol.localeCompare(y.symbol) ||
            (x.platform ?? "").localeCompare(y.platform ?? "")
        );
        setHoldings(hs);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [portfolioId]);

  /* --- Bilinen platformlar (chip önerisi) --- */
  const knownPlatforms = useMemo(() => {
    const set = new Set<string>();
    for (const h of holdings) if (h.platform) set.add(h.platform);
    for (const a of portfolioAssets)
      if (a.platform && a.platform.trim()) set.add(a.platform.trim());
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [holdings, portfolioAssets]);

  /* --- fx yardımcıları --- */
  const fxToUsd = (ccy: string) => convertViaTry(1, ccy, "USD", rates);
  const usdToDisplay = (usd: number) =>
    convertViaTry(usd, "USD", displayCurrency, rates);

  /* --- Toplamlar --- */
  const totalSoldUsd = useMemo(() => {
    let sum = 0;
    for (const leg of sellLegs) {
      const h = holdings.find((x) => x.key === leg.holdingKey);
      if (!h) continue;
      const q = parseDecimal(leg.quantity);
      const p = parseDecimal(leg.price);
      if (!Number.isFinite(q) || !Number.isFinite(p) || q <= 0 || p <= 0)
        continue;
      sum += q * p * fxToUsd(h.currency);
    }
    return sum;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sellLegs, holdings, rates]);

  const totalBoughtQty = useMemo(() => {
    let sum = 0;
    for (const leg of buyLegs) {
      const q = parseDecimal(leg.quantity);
      if (Number.isFinite(q) && q > 0) sum += q;
    }
    return sum;
  }, [buyLegs]);

  /** Otomatik birim maliyet — satılan toplam değer / alınan toplam miktar. */
  const autoPriceFor = (leg: BuyLeg): string => {
    if (!leg.picked || totalBoughtQty <= 0 || totalSoldUsd <= 0) return "";
    const perUnitUsd = totalSoldUsd / totalBoughtQty;
    const v = convertViaTry(perUnitUsd, "USD", leg.picked.currency, rates);
    return v > 0 ? fmtNum(v) : "";
  };
  /** Bir alınan bacağın geçerli fiyatı — override edildiyse o, yoksa otomatik. */
  const effectivePrice = (leg: BuyLeg): string =>
    leg.priceTouched ? leg.price : autoPriceFor(leg);

  const boughtTotalUsd = useMemo(() => {
    let sum = 0;
    for (const leg of buyLegs) {
      if (!leg.picked) continue;
      const q = parseDecimal(leg.quantity);
      const p = parseDecimal(effectivePrice(leg));
      if (!Number.isFinite(q) || !Number.isFinite(p) || q <= 0 || p <= 0)
        continue;
      sum += q * p * fxToUsd(leg.picked.currency);
    }
    return sum;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buyLegs, rates, totalSoldUsd, totalBoughtQty]);

  /* --- Leg mutasyonları --- */
  const patchSell = (uid: string, patch: Partial<SellLeg>) =>
    setSellLegs((legs) =>
      legs.map((l) => (l.uid === uid ? { ...l, ...patch } : l))
    );
  const patchBuy = (uid: string, patch: Partial<BuyLeg>) =>
    setBuyLegs((legs) =>
      legs.map((l) => (l.uid === uid ? { ...l, ...patch } : l))
    );

  const sellUsedKeys = useMemo(
    () => new Set(sellLegs.map((l) => l.holdingKey).filter(Boolean)),
    [sellLegs]
  );

  /* --- Submit --- */
  const triggerShake = () => {
    playSound("error");
    setShakeKey((k) => k + 1);
  };

  const onSubmit = async () => {
    // Her satılan bacak: holding + qty>0 + price>0
    const sellPayload: SwapSellLeg[] = [];
    for (const leg of sellLegs) {
      const h = holdings.find((x) => x.key === leg.holdingKey);
      const q = parseDecimal(leg.quantity);
      const p = parseDecimal(leg.price);
      if (!h) {
        triggerShake();
        toast.error("Her satılan satırda bir varlık seç");
        return;
      }
      if (!Number.isFinite(q) || q <= 0) {
        triggerShake();
        toast.error(`${h.symbol}: satılan miktar 0'dan büyük olmalı`);
        return;
      }
      if (!Number.isFinite(p) || p <= 0) {
        triggerShake();
        toast.error(`${h.symbol}: satış fiyatı 0'dan büyük olmalı`);
        return;
      }
      sellPayload.push({
        assetId: h.assetId,
        platform: h.platform,
        quantity: q,
        price: p,
        fee: null,
      });
    }

    // Her alınan bacak: picked + qty>0 + price>0
    const buyPayload: SwapBuyLeg[] = [];
    for (const leg of buyLegs) {
      if (!leg.picked) {
        triggerShake();
        toast.error("Her alınan satırda bir varlık seç");
        return;
      }
      const q = parseDecimal(leg.quantity);
      const p = parseDecimal(effectivePrice(leg));
      if (!Number.isFinite(q) || q <= 0) {
        triggerShake();
        toast.error(`${leg.picked.symbol}: alınan miktar 0'dan büyük olmalı`);
        return;
      }
      if (!Number.isFinite(p) || p <= 0) {
        triggerShake();
        toast.error(`${leg.picked.symbol}: birim maliyet hesaplanamadı`);
        return;
      }
      let yieldVal: number | null = null;
      if (leg.yieldPct.trim() !== "") {
        const y = parseDecimal(leg.yieldPct);
        if (!Number.isFinite(y) || y < 0 || y > 1000) {
          triggerShake();
          toast.error(`${leg.picked.symbol}: yıllık getiri 0-1000% arasında olmalı`);
          return;
        }
        yieldVal = y;
      }
      buyPayload.push({
        symbol: leg.picked.symbol,
        name: leg.picked.name || leg.picked.symbol,
        assetType: leg.picked.assetType,
        currency: leg.picked.currency,
        externalId: leg.picked.externalId,
        iconUrl: leg.picked.iconUrl,
        expectedYieldPct: yieldVal,
        platform: leg.platform.trim() || null,
        quantity: q,
        price: p,
        fee: null,
      });
    }

    if (sellPayload.length === 0 || buyPayload.length === 0) {
      triggerShake();
      toast.error("En az bir satılan ve bir alınan varlık gerekli");
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.createSwapTransaction({
        portfolioId,
        date: dateInputToUnix(date),
        sellLegs: sellPayload,
        buyLegs: buyPayload,
        note: note.trim() || null,
      });
      await refreshAssets(portfolioId).catch(() => {});
      recompute(portfolioId, displayCurrency).catch(() => {});
      playSound("ding");
      celebrateSmall();
      toast.success(
        `Takas kaydedildi — ${res.sell_count} satış, ${res.buy_count} alış`
      );
      closeModal();
    } catch (err) {
      playSound("error");
      toast.error("Takas kaydedilemedi", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  };

  /* --- Özet (display currency) --- */
  const soldDisplay = usdToDisplay(totalSoldUsd);
  const boughtDisplay = usdToDisplay(boughtTotalUsd);
  const diff = boughtDisplay - soldDisplay;
  const hasDiff = Math.abs(diff) > 0.01 && totalSoldUsd > 0 && boughtTotalUsd > 0;

  return (
    <ModalShell
      title="İşlem Ekle"
      description="Bir veya birden fazla varlığı satıp başkalarını al — takas"
      footer={
        <>
          <button onClick={closeModal} className={buttonGhost} disabled={submitting}>
            İptal
          </button>
          <button
            onClick={onSubmit}
            disabled={submitting || loading || holdings.length === 0}
            className={buttonPrimary}
          >
            {submitting ? "Kaydediliyor…" : "Kaydet"}
          </button>
        </>
      }
    >
      <div key={shakeKey} className={shakeKey > 0 ? "animate-shake" : ""}>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        ) : holdings.length === 0 ? (
          <div className="rounded-xl border border-dashed border-(--color-border-subtle) bg-(--color-bg-base)/40 px-5 py-8 text-center">
            <p className="text-sm text-(--color-text-secondary)">
              Bu portföyde satılabilecek varlık yok.
            </p>
            <p className="mt-1 text-xs text-(--color-text-tertiary)">
              Önce "Varlık Ekle" ile bir varlık ve alım işlemi gir.
            </p>
          </div>
        ) : (
          <>
            {/* Tarih */}
            <div className="mb-4 flex items-center gap-2">
              <span className="text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
                Tarih
              </span>
              <input
                type="date"
                value={date}
                max={todayLocalDateInput()}
                onChange={(e) => setDate(e.target.value)}
                className={cn(inputClass, "w-auto")}
              />
            </div>

            {/* SATILAN */}
            <div className="mb-2 flex items-center gap-2">
              <span className="grid h-5 w-5 place-items-center rounded bg-(--color-danger)/15 text-(--color-danger)">
                <Trash2 className="h-3 w-3" />
              </span>
              <h3 className="text-[11px] font-semibold tracking-[0.06em] text-(--color-text-secondary) uppercase">
                Satılan varlıklar
              </h3>
            </div>
            <div className="space-y-2">
              {sellLegs.map((leg) => (
                <SellLegRow
                  key={leg.uid}
                  leg={leg}
                  holdings={holdings}
                  excludeKeys={
                    new Set(
                      [...sellUsedKeys].filter((k) => k !== leg.holdingKey)
                    )
                  }
                  displayCurrency={displayCurrency}
                  usdToDisplay={usdToDisplay}
                  fxToUsd={fxToUsd}
                  onPatch={(p) => patchSell(leg.uid, p)}
                  onRemove={() =>
                    setSellLegs((l) => l.filter((x) => x.uid !== leg.uid))
                  }
                  canRemove={sellLegs.length > 1}
                />
              ))}
            </div>
            <button
              onClick={() => setSellLegs((l) => [...l, blankSell()])}
              className="mt-2 inline-flex items-center gap-1 rounded-md border border-dashed border-(--color-border-subtle) px-2.5 py-1 text-xs text-(--color-text-tertiary) transition-colors hover:border-(--color-danger)/40 hover:text-(--color-danger)"
            >
              <Plus className="h-3 w-3" />
              Satılan ekle
            </button>

            {/* Ayraç */}
            <div className="my-4 flex items-center gap-2 text-(--color-text-tertiary)">
              <div className="h-px flex-1 bg-(--color-border-subtle)" />
              <ArrowLeftRight className="h-3.5 w-3.5" />
              <div className="h-px flex-1 bg-(--color-border-subtle)" />
            </div>

            {/* ALINAN */}
            <div className="mb-2 flex items-center gap-2">
              <span className="grid h-5 w-5 place-items-center rounded bg-(--color-success)/15 text-(--color-success)">
                <Plus className="h-3 w-3" />
              </span>
              <h3 className="text-[11px] font-semibold tracking-[0.06em] text-(--color-text-secondary) uppercase">
                Alınan varlıklar
              </h3>
            </div>
            <div className="space-y-2">
              {buyLegs.map((leg) => (
                <BuyLegRow
                  key={leg.uid}
                  leg={leg}
                  portfolioAssets={portfolioAssets}
                  holdings={holdings}
                  knownPlatforms={knownPlatforms}
                  priceValue={effectivePrice(leg)}
                  priceIsAuto={!leg.priceTouched}
                  displayCurrency={displayCurrency}
                  fxToUsd={fxToUsd}
                  usdToDisplay={usdToDisplay}
                  onPatch={(p) => patchBuy(leg.uid, p)}
                  onRemove={() =>
                    setBuyLegs((l) => l.filter((x) => x.uid !== leg.uid))
                  }
                  canRemove={buyLegs.length > 1}
                />
              ))}
            </div>
            <button
              onClick={() => setBuyLegs((l) => [...l, blankBuy()])}
              className="mt-2 inline-flex items-center gap-1 rounded-md border border-dashed border-(--color-border-subtle) px-2.5 py-1 text-xs text-(--color-text-tertiary) transition-colors hover:border-(--color-success)/40 hover:text-(--color-success)"
            >
              <Plus className="h-3 w-3" />
              Alınan ekle
            </button>

            {/* Not */}
            <div className="mt-4">
              <label className="text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
                Not (opsiyonel)
              </label>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="örn: USDT → BTC takası"
                className={cn(inputClass, "mt-1.5")}
              />
            </div>

            {/* Özet */}
            <div className="mt-4 rounded-lg border border-(--color-border-subtle) bg-(--color-bg-base)/60 px-4 py-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-(--color-text-secondary)">
                  Satılan toplam
                </span>
                <span className="tabular text-(--color-danger)">
                  {formatCurrency(soldDisplay, displayCurrency, "summary")}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-(--color-text-secondary)">
                  Alınan maliyet
                </span>
                <span className="tabular text-(--color-success)">
                  {formatCurrency(boughtDisplay, displayCurrency, "summary")}
                </span>
              </div>
              {hasDiff && (
                <div className="mt-1.5 flex items-center justify-between border-t border-(--color-border-subtle) pt-1.5 text-xs">
                  <span className="text-(--color-text-tertiary)">
                    Fark (maliyeti elle değiştirdin)
                  </span>
                  <span
                    className={cn(
                      "tabular",
                      diff >= 0
                        ? "text-(--color-text-secondary)"
                        : "text-(--color-warning)"
                    )}
                  >
                    {diff >= 0 ? "+" : ""}
                    {formatCurrency(diff, displayCurrency, "summary")}
                  </span>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </ModalShell>
  );
}

/* ------------------------------------------------------------------ */
/* Satılan bacak satırı                                               */
/* ------------------------------------------------------------------ */

function SellLegRow({
  leg,
  holdings,
  excludeKeys,
  displayCurrency,
  usdToDisplay,
  fxToUsd,
  onPatch,
  onRemove,
  canRemove,
}: {
  leg: SellLeg;
  holdings: Holding[];
  excludeKeys: Set<string>;
  displayCurrency: string;
  usdToDisplay: (usd: number) => number;
  fxToUsd: (ccy: string) => number;
  onPatch: (patch: Partial<SellLeg>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const picked = holdings.find((h) => h.key === leg.holdingKey) ?? null;

  const filtered = holdings.filter((h) => {
    if (excludeKeys.has(h.key)) return false;
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return (
      h.symbol.toLowerCase().includes(needle) ||
      h.name.toLowerCase().includes(needle) ||
      (h.platform ?? "").toLowerCase().includes(needle)
    );
  });

  const pick = (h: Holding) => {
    onPatch({
      holdingKey: h.key,
      price:
        leg.price || (h.cachedPrice != null ? fmtNum(h.cachedPrice) : leg.price),
    });
    setOpen(false);
    setQ("");
  };

  const qty = parseDecimal(leg.quantity);
  const prc = parseDecimal(leg.price);
  const legValueUsd =
    picked && Number.isFinite(qty) && Number.isFinite(prc) && qty > 0 && prc > 0
      ? qty * prc * fxToUsd(picked.currency)
      : null;
  const overBalance =
    picked != null && Number.isFinite(qty) && qty > picked.netQty + 1e-9;

  return (
    <div className="rounded-lg border border-(--color-border-subtle) bg-(--color-bg-base)/40 p-2.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-(--color-border-subtle) bg-(--color-bg-panel) px-2.5 py-1.5 text-left transition-colors hover:border-(--color-border-strong)"
        >
          {picked ? (
            <>
              <AssetIcon
                symbol={picked.symbol}
                iconUrl={picked.iconUrl}
                type={picked.assetType}
                size={22}
              />
              <span className="min-w-0 flex-1">
                <span className="text-sm font-medium tabular">
                  {picked.symbol}
                </span>
                <span className="ml-1.5 text-xs text-(--color-text-tertiary)">
                  {picked.platform ?? "Belirtilmemiş"}
                </span>
              </span>
              <span className="shrink-0 text-[11px] text-(--color-text-tertiary)">
                {fmtNum(picked.netQty)} mevcut
              </span>
            </>
          ) : (
            <span className="flex-1 text-sm text-(--color-text-tertiary)">
              Satılan varlık seç…
            </span>
          )}
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-(--color-text-tertiary) transition-transform",
              open && "rotate-180"
            )}
          />
        </button>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label="Satırı kaldır"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-(--color-text-tertiary) transition-colors hover:bg-(--color-danger)/10 hover:text-(--color-danger)"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Holding seçici */}
      {open && (
        <div className="mt-2 overflow-hidden rounded-md border border-(--color-border-subtle) bg-(--color-bg-panel)">
          <div className="relative border-b border-(--color-border-subtle)">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-(--color-text-tertiary)" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Varlık veya platform ara…"
              className="w-full bg-transparent py-2 pl-8 pr-3 text-sm outline-none placeholder:text-(--color-text-tertiary)"
            />
          </div>
          <div className="max-h-44 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-(--color-text-tertiary)">
                Eşleşen varlık yok.
              </p>
            ) : (
              filtered.map((h) => (
                <button
                  key={h.key}
                  type="button"
                  onClick={() => pick(h)}
                  className="flex w-full items-center gap-2 border-b border-(--color-border-subtle) px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-(--color-bg-hover)"
                >
                  <AssetIcon
                    symbol={h.symbol}
                    iconUrl={h.iconUrl}
                    type={h.assetType}
                    size={22}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="text-sm font-medium tabular">
                      {h.symbol}
                    </span>
                    <span className="ml-1.5 text-xs text-(--color-text-tertiary)">
                      {h.platform ?? "Belirtilmemiş"}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] text-(--color-text-tertiary)">
                    {fmtNum(h.netQty)} mevcut
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Miktar + fiyat */}
      {picked && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[10px] tracking-wide text-(--color-text-tertiary) uppercase">
              Miktar
            </span>
            <div className="relative mt-0.5">
              <input
                inputMode="decimal"
                value={leg.quantity}
                onChange={(e) => onPatch({ quantity: e.target.value })}
                placeholder={`maks ${fmtNum(picked.netQty)}`}
                className={cn(
                  inputClass,
                  "pr-12",
                  overBalance && "border-(--color-warning)"
                )}
              />
              <button
                type="button"
                onClick={() => onPatch({ quantity: fmtNum(picked.netQty) })}
                title={`Tümünü sat — ${fmtNum(picked.netQty)}`}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded bg-(--color-bg-hover) px-1.5 py-0.5 text-[10px] font-semibold text-(--color-text-secondary) transition-colors hover:bg-(--color-accent)/15 hover:text-(--color-accent)"
              >
                maks
              </button>
            </div>
          </label>
          <label className="block">
            <span className="text-[10px] tracking-wide text-(--color-text-tertiary) uppercase">
              Birim fiyat ({picked.currency})
            </span>
            <input
              inputMode="decimal"
              value={leg.price}
              onChange={(e) => onPatch({ price: e.target.value })}
              placeholder="örn: 1"
              className={cn(inputClass, "mt-0.5")}
            />
          </label>
        </div>
      )}
      {picked && (overBalance || legValueUsd != null) && (
        <div className="mt-1 flex items-center justify-between text-[11px]">
          <span className="text-(--color-warning)">
            {overBalance
              ? `Bu platformda ${fmtNum(picked.netQty)} mevcut — eksiye düşecek`
              : ""}
          </span>
          {legValueUsd != null && (
            <span className="tabular text-(--color-text-tertiary)">
              ≈ {formatCurrency(usdToDisplay(legValueUsd), displayCurrency, "summary")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Alınan bacak satırı                                                */
/* ------------------------------------------------------------------ */

function relevanceScore(hit: SearchHit, q: string): number {
  const sym = hit.symbol.toUpperCase();
  const name = (hit.name || "").toUpperCase();
  if (sym === q) return 1000;
  if (sym.startsWith(q)) return 500;
  if (sym.includes(q)) return 250;
  if (name.startsWith(q)) return 100;
  if (name.includes(q)) return 50;
  return 0;
}

function BuyLegRow({
  leg,
  portfolioAssets,
  holdings,
  knownPlatforms,
  priceValue,
  priceIsAuto,
  displayCurrency,
  fxToUsd,
  usdToDisplay,
  onPatch,
  onRemove,
  canRemove,
}: {
  leg: BuyLeg;
  portfolioAssets: Asset[];
  holdings: Holding[];
  knownPlatforms: string[];
  priceValue: string;
  priceIsAuto: boolean;
  displayCurrency: string;
  fxToUsd: (ccy: string) => number;
  usdToDisplay: (usd: number) => number;
  onPatch: (patch: Partial<BuyLeg>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const debounced = useDebounce(q, 300);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  /* Sembol araması — kripto + hisse paralel */
  useEffect(() => {
    if (debounced.trim().length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    Promise.all([
      api.searchSymbol(debounced, "crypto").catch(() => [] as SearchHit[]),
      api.searchSymbol(debounced, "stock").catch(() => [] as SearchHit[]),
    ])
      .then(([c, s]) => {
        if (cancelled) return;
        const qq = debounced.trim().toUpperCase();
        const merged = [...c, ...s].sort(
          (a, b) => relevanceScore(b, qq) - relevanceScore(a, qq)
        );
        setHits(merged.slice(0, 20));
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  /* Portföyde eşleşen varlıklar — öne çıkar */
  const existingMatches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = portfolioAssets;
    if (needle)
      list = list.filter(
        (a) =>
          a.symbol.toLowerCase().includes(needle) ||
          a.name.toLowerCase().includes(needle)
      );
    return list.slice(0, 8);
  }, [q, portfolioAssets]);

  /* Seçilen sembolün portföydeki platformları (chip önceliği) */
  const platformsForPicked = useMemo(() => {
    if (!leg.picked) return [];
    const set = new Set<string>();
    for (const h of holdings)
      if (h.symbol === leg.picked.symbol.toUpperCase() && h.platform)
        set.add(h.platform);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [leg.picked, holdings]);

  const platformChips = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of [...platformsForPicked, ...knownPlatforms]) {
      if (!seen.has(p)) {
        seen.add(p);
        out.push(p);
      }
    }
    return out.slice(0, 8);
  }, [platformsForPicked, knownPlatforms]);

  const pickExisting = (a: Asset) => {
    onPatch({
      picked: {
        symbol: a.symbol,
        name: a.name,
        assetType: a.type,
        currency: a.currency,
        externalId: a.external_id,
        iconUrl: a.icon_url,
        existingAssetId: a.id,
      },
      // Mevcut varlığın faiz/getiri oranını öneri olarak doldur
      yieldPct: a.expected_yield_pct != null ? String(a.expected_yield_pct) : "",
    });
    setOpen(false);
    setQ("");
  };
  const pickHit = (h: SearchHit) => {
    // Aynı sembol portföyde varsa onun currency/icon'unu tercih et
    const existing = portfolioAssets.find(
      (a) => a.symbol === h.symbol.toUpperCase()
    );
    onPatch({
      picked: {
        symbol: h.symbol.toUpperCase(),
        name: h.name || h.symbol,
        assetType: (existing?.type ?? (h.asset_type as Asset["type"])) || "crypto",
        currency: existing?.currency ?? "USD",
        externalId: h.external_id ?? existing?.external_id ?? null,
        iconUrl: h.icon ?? existing?.icon_url ?? null,
        existingAssetId: existing?.id ?? null,
      },
      yieldPct:
        existing?.expected_yield_pct != null
          ? String(existing.expected_yield_pct)
          : "",
    });
    setOpen(false);
    setQ("");
  };

  const qty = parseDecimal(leg.quantity);
  const prc = parseDecimal(priceValue);
  const legValueUsd =
    leg.picked &&
    Number.isFinite(qty) &&
    Number.isFinite(prc) &&
    qty > 0 &&
    prc > 0
      ? qty * prc * fxToUsd(leg.picked.currency)
      : null;

  return (
    <div className="rounded-lg border border-(--color-border-subtle) bg-(--color-bg-base)/40 p-2.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-(--color-border-subtle) bg-(--color-bg-panel) px-2.5 py-1.5 text-left transition-colors hover:border-(--color-border-strong)"
        >
          {leg.picked ? (
            <>
              <AssetIcon
                symbol={leg.picked.symbol}
                iconUrl={leg.picked.iconUrl}
                type={leg.picked.assetType}
                size={22}
              />
              <span className="min-w-0 flex-1">
                <span className="text-sm font-medium tabular">
                  {leg.picked.symbol}
                </span>
                <span className="ml-1.5 truncate text-xs text-(--color-text-tertiary)">
                  {leg.picked.name}
                </span>
              </span>
              {leg.picked.existingAssetId != null && (
                <span className="shrink-0 rounded bg-(--color-accent)/15 px-1.5 py-0.5 text-[10px] tracking-wide text-(--color-accent)">
                  portföyünde
                </span>
              )}
            </>
          ) : (
            <span className="flex-1 text-sm text-(--color-text-tertiary)">
              Alınan varlık seç…
            </span>
          )}
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-(--color-text-tertiary) transition-transform",
              open && "rotate-180"
            )}
          />
        </button>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label="Satırı kaldır"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-(--color-text-tertiary) transition-colors hover:bg-(--color-danger)/10 hover:text-(--color-danger)"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Sembol seçici */}
      {open && (
        <div className="mt-2 overflow-hidden rounded-md border border-(--color-border-subtle) bg-(--color-bg-panel)">
          <div className="relative border-b border-(--color-border-subtle)">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-(--color-text-tertiary)" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Sembol ara — örn: BTC, AAPL…"
              className="w-full bg-transparent py-2 pl-8 pr-3 text-sm outline-none placeholder:text-(--color-text-tertiary)"
            />
          </div>
          <div className="max-h-52 overflow-y-auto">
            {existingMatches.length > 0 && (
              <>
                <div className="bg-(--color-bg-base)/50 px-3 py-1 text-[10px] font-medium tracking-[0.06em] text-(--color-text-tertiary) uppercase">
                  Portföyünde
                </div>
                {existingMatches.map((a) => (
                  <button
                    key={`ex-${a.id}`}
                    type="button"
                    onClick={() => pickExisting(a)}
                    className="flex w-full items-center gap-2 border-b border-(--color-border-subtle) px-3 py-2 text-left transition-colors hover:bg-(--color-bg-hover)"
                  >
                    <AssetIcon
                      symbol={a.symbol}
                      iconUrl={a.icon_url}
                      type={a.type}
                      size={22}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="text-sm font-medium tabular">
                        {a.symbol}
                      </span>
                      <span className="ml-1.5 truncate text-xs text-(--color-text-tertiary)">
                        {a.name}
                      </span>
                    </span>
                    <Wallet className="h-3.5 w-3.5 shrink-0 text-(--color-accent)" />
                  </button>
                ))}
              </>
            )}
            {searching && (
              <div className="space-y-1.5 p-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            )}
            {!searching && debounced.trim().length >= 2 && (
              <>
                <div className="bg-(--color-bg-base)/50 px-3 py-1 text-[10px] font-medium tracking-[0.06em] text-(--color-text-tertiary) uppercase">
                  Arama sonuçları
                </div>
                {hits.length === 0 ? (
                  <p className="px-3 py-3 text-center text-xs text-(--color-text-tertiary)">
                    Sonuç yok.
                  </p>
                ) : (
                  hits.map((h) => (
                    <button
                      key={`${h.asset_type}-${h.external_id}`}
                      type="button"
                      onClick={() => pickHit(h)}
                      className="flex w-full items-center gap-2 border-b border-(--color-border-subtle) px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-(--color-bg-hover)"
                    >
                      <AssetIcon
                        symbol={h.symbol}
                        iconUrl={h.icon}
                        type={h.asset_type}
                        size={22}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="text-sm font-medium tabular">
                          {h.symbol}
                        </span>
                        <span className="ml-1.5 truncate text-xs text-(--color-text-tertiary)">
                          {h.name}
                        </span>
                      </span>
                      <Plus className="h-3.5 w-3.5 shrink-0 text-(--color-text-tertiary)" />
                    </button>
                  ))
                )}
              </>
            )}
            {!searching &&
              debounced.trim().length < 2 &&
              existingMatches.length === 0 && (
                <p className="px-3 py-4 text-center text-xs text-(--color-text-tertiary)">
                  Aramak için en az 2 karakter yaz.
                </p>
              )}
          </div>
        </div>
      )}

      {/* Platform + miktar + maliyet */}
      {leg.picked && (
        <div className="mt-2 space-y-2">
          <div>
            <span className="text-[10px] tracking-wide text-(--color-text-tertiary) uppercase">
              Platform
            </span>
            <input
              value={leg.platform}
              onChange={(e) => onPatch({ platform: e.target.value })}
              placeholder="örn: Binance, OKX"
              className={cn(inputClass, "mt-0.5")}
            />
            {platformChips.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {platformChips.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => onPatch({ platform: p })}
                    className={cn(
                      "rounded-md border px-2 py-0.5 text-[11px] transition-colors",
                      leg.platform.trim() === p
                        ? "border-(--color-accent)/50 bg-(--color-accent)/15 text-(--color-accent)"
                        : "border-(--color-border-subtle) bg-(--color-bg-panel) text-(--color-text-secondary) hover:border-(--color-border-strong)"
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[10px] tracking-wide text-(--color-text-tertiary) uppercase">
                Miktar
              </span>
              <input
                inputMode="decimal"
                value={leg.quantity}
                onChange={(e) => onPatch({ quantity: e.target.value })}
                placeholder="örn: 1"
                className={cn(inputClass, "mt-0.5")}
              />
            </label>
            <label className="block">
              <span className="flex items-center gap-1 text-[10px] tracking-wide text-(--color-text-tertiary) uppercase">
                Birim maliyet ({leg.picked.currency})
                {priceIsAuto ? (
                  <span className="text-(--color-accent) normal-case tracking-normal">
                    otomatik
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      onPatch({ price: "", priceTouched: false })
                    }
                    title="Otomatik maliyete dön"
                    className="inline-flex items-center text-(--color-text-tertiary) hover:text-(--color-accent)"
                  >
                    <RotateCcw className="h-3 w-3" />
                  </button>
                )}
              </span>
              <input
                inputMode="decimal"
                value={priceValue}
                onChange={(e) =>
                  onPatch({ price: e.target.value, priceTouched: true })
                }
                placeholder="otomatik hesaplanır"
                className={cn(inputClass, "mt-0.5")}
              />
            </label>
          </div>
          <label className="flex items-center gap-2">
            <span className="shrink-0 text-[10px] tracking-wide text-(--color-text-tertiary) uppercase">
              Yıllık getiri
            </span>
            <input
              inputMode="decimal"
              value={leg.yieldPct}
              onChange={(e) => onPatch({ yieldPct: e.target.value })}
              placeholder="opsiyonel — staking / faiz"
              className={cn(inputClass, "flex-1")}
            />
            <span className="shrink-0 text-xs text-(--color-text-tertiary)">
              % / yıl
            </span>
          </label>
          {legValueUsd != null && (
            <div className="text-right text-[11px] tabular text-(--color-text-tertiary)">
              ≈ {formatCurrency(usdToDisplay(legValueUsd), displayCurrency, "summary")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
