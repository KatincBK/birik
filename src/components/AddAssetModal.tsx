import { useEffect, useState } from "react";
import { Search, Plus, ArrowLeft, Info, ChevronDown, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  ModalShell,
  Field,
  inputClass,
  buttonPrimary,
  buttonGhost,
  buttonSecondary,
} from "./Modal";
import { Skeleton } from "./Skeleton";
import { AssetIcon } from "./AssetIcon";
import { api, type Asset } from "../lib/api";
import { useAssetStore } from "../stores/assetStore";
import { usePortfolioStore } from "../stores/portfolioStore";
import { PlatformChipList } from "./PlatformChipList";

const LAST_PLATFORM_KEY = "birik.lastPlatform";
const RECENT_SEARCHES_KEY = "birik.recentSearches";
const MAX_RECENT = 8;

function loadRecentSearches(): SearchHit[] {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr.slice(0, MAX_RECENT);
  } catch {}
  return [];
}
function saveRecentSearch(hit: SearchHit) {
  try {
    const list = loadRecentSearches().filter(
      (h) =>
        !(h.symbol === hit.symbol && h.asset_type === hit.asset_type)
    );
    list.unshift(hit);
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
  } catch {}
}
import { useTransactionStore } from "../stores/transactionStore";
import { useStatsStore } from "../stores/statsStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useDebounce } from "../hooks/useDebounce";
import { useUIStore } from "../stores/uiStore";
import { assetTypeColor } from "../lib/colors";
import { cn } from "../lib/cn";
import { playSound } from "../lib/sounds";
import { celebrateSmall } from "../lib/celebrate";

type AssetTypeKey = Asset["type"];
/** UI seçici tipleri — fx artık görünmüyor (commodity altında birleşik). */
type UiPickerKey = "all" | "stock" | "crypto" | "commodity";
const UI_PICKER: { key: UiPickerKey; label: string }[] = [
  { key: "all", label: "Hepsi" },
  { key: "stock", label: "Hisse" },
  { key: "crypto", label: "Kripto" },
  { key: "commodity", label: "Emtia" },
];

type SearchHit = {
  external_id: string;
  symbol: string;
  name: string;
  icon: string | null;
  asset_type: string;
  exchange: string | null;
};

/** Hisse adından Clearbit domain tahmini. */
function guessDomainSlug(name: string, fallbackSymbol: string): string {
  const stop = new Set([
    "inc","inc.","corp","corp.","corporation","company","co","co.",
    "ltd","ltd.","plc","the","&","and","group","holdings","holding","limited",
  ]);
  const words = (name || "")
    .toLowerCase()
    .replace(/[,\.]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !stop.has(w));
  return words[0] || fallbackSymbol.toLowerCase();
}

function todayLocalDateInput(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dateInputToUnix(s: string): number {
  return Math.floor(new Date(s + "T00:00:00").getTime() / 1000);
}

function parseDecimal(raw: string): number {
  const s = raw.replace(/\s/g, "").replace(",", ".");
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : NaN;
}

type Stage = "search" | "form";

/**
 * Yeni 2-aşamalı varlık ekleme akışı.
 *   1. search: tip + autocomplete (kripto/hisse) veya manuel (fx/commodity)
 *   2. form:  miktar + fiyat + nakit akışı + (advanced: tarih/fee/not/etiket)
 *
 * Asset henüz DB'de YOK — backend `find_or_create_asset` ilk kayıt anında
 * oluşturur (mevcut UNIQUE conflict yaşanmaz, var olanı bulur).
 *
 * Form'da 3 buton:
 *   - İptal: hiçbir şey kaydedilmez
 *   - Kaydet: işlem girilir, modal kapanır
 *   - Kaydet ve sonra ekle: işlem girilir, form sıfırlanır, asset header korunur
 */
export function AddAssetModal({ portfolioId }: { portfolioId: number }) {
  const [stage, setStage] = useState<Stage>("search");
  const [pickerType, setPickerType] = useState<UiPickerKey>("all");
  /** Form aşamasında kullanılacak gerçek asset tipi — search hit'inden gelir. */
  const [pickedAssetType, setPickedAssetType] = useState<AssetTypeKey>("crypto");
  const [query, setQuery] = useState("");
  const debounced = useDebounce(query, 300);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [recent, setRecent] = useState<SearchHit[]>(() => loadRecentSearches());
  const [searching, setSearching] = useState(false);

  // Manuel (fx/commodity) için
  const [manualSymbol, setManualSymbol] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualCurrency, setManualCurrency] = useState("TRY");

  // Seçilen asset bilgisi (henüz DB'ye yazılmadı; form aşamasında kullanılır)
  const [pickedHit, setPickedHit] = useState<SearchHit | null>(null);
  const [pickedCurrency, setPickedCurrency] = useState<string>("USD");

  // Form alanları
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [yieldPct, setYieldPct] = useState("");
  // Son kullanılan platformu localStorage'dan default olarak al
  const [platform, setPlatform] = useState(
    () => localStorage.getItem(LAST_PLATFORM_KEY) ?? ""
  );
  const [platformFocused, setPlatformFocused] = useState(false);
  const [platformExpanded, setPlatformExpanded] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [date, setDate] = useState(todayLocalDateInput());
  const [fee, setFee] = useState("");
  const [note, setNote] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);

  const closeModal = useUIStore((s) => s.closeModal);
  const refreshAssets = useAssetStore((s) => s.refresh);
  const byPortfolio = useAssetStore((s) => s.byPortfolio);
  const portfolios = usePortfolioStore((s) => s.portfolios);

  // Mevcut tüm benzersiz platformlar — dropdown önerisi için
  const knownPlatforms = (() => {
    const set = new Set<string>();
    for (const p of portfolios) {
      for (const a of byPortfolio[p.id] ?? []) {
        if (a.platform && a.platform.trim()) set.add(a.platform.trim());
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  })();
  const createTx = useTransactionStore((s) => s.create);
  const recompute = useStatsStore((s) => s.recompute);
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);

  const isAutocomplete =
    pickerType === "crypto" || pickerType === "stock" || pickerType === "all";

  /* Search effect — "all" iki fetcher paralel */
  useEffect(() => {
    if (!isAutocomplete) {
      setHits([]);
      return;
    }
    if (debounced.trim().length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    setSearching(true);

    const enrichStock = (h: SearchHit): SearchHit => ({
      ...h,
      icon:
        h.icon ??
        `https://logo.clearbit.com/${guessDomainSlug(h.name, h.symbol)}.com`,
    });

    type Result = { hits: SearchHit[]; source: string; error?: string };
    const fetches: Promise<Result>[] = [];
    if (pickerType === "crypto" || pickerType === "all") {
      fetches.push(
        api
          .searchSymbol(debounced, "crypto")
          .then((hits) => ({ hits, source: "crypto" }))
          .catch((err) => ({
            hits: [],
            source: "crypto",
            error: err instanceof Error ? err.message : String(err),
          }))
      );
    }
    if (pickerType === "stock" || pickerType === "all") {
      fetches.push(
        api
          .searchSymbol(debounced, "stock")
          .then((r) => ({ hits: r.map(enrichStock), source: "stock" }))
          .catch((err) => ({
            hits: [],
            source: "stock",
            error: err instanceof Error ? err.message : String(err),
          }))
      );
    }

    Promise.all(fetches)
      .then((results) => {
        if (cancelled) return;
        for (const r of results) {
          if (r.error) {
            console.warn(`[birik] search ${r.source} failed:`, r.error);
            toast.error(`${r.source === "stock" ? "Yahoo" : "CoinGecko"} araması hata`, {
              description: r.error,
            });
          }
        }
        const merged = results.flatMap((r) => r.hits);

        // Relevance score:
        //   exact symbol match    → 1000
        //   symbol startsWith q   → 500
        //   symbol contains q     → 250
        //   name startsWith q     → 100
        //   name contains q       → 50
        //   eşleşme yok           → 0
        // Eşit score'da hisse > kripto (US hisse seçimleri öncelikli — kullanıcı
        // genellikle ticker yazıyor)
        const q = debounced.trim().toUpperCase();
        const scoreOf = (h: SearchHit): number => {
          const sym = h.symbol.toUpperCase();
          const name = (h.name || "").toUpperCase();
          if (sym === q) return 1000;
          if (sym.startsWith(q)) return 500;
          if (sym.includes(q)) return 250;
          if (name.startsWith(q)) return 100;
          if (name.includes(q)) return 50;
          return 0;
        };
        const typeWeight = (t: string) => (t === "stock" ? 5 : t === "crypto" ? 1 : 0);

        const ranked = merged
          .map((h) => ({ h, s: scoreOf(h), w: typeWeight(h.asset_type) }))
          .sort((a, b) => b.s - a.s || b.w - a.w)
          .map((x) => x.h)
          .slice(0, 30);

        setHits(ranked);
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });

    return () => {
      cancelled = true;
    };
  }, [debounced, pickerType, isAutocomplete]);

  /* Stage 'form'a geçtiğinde fiyatı önceden doldur — önce mevcut asset
   * cache'inden, yoksa canlı API'den (Binance/Yahoo). Kullanıcı sıfırdan
   * yazmasın diye. */
  useEffect(() => {
    if (stage !== "form" || !pickedHit) return;
    if (price !== "") return;
    let cancelled = false;
    (async () => {
      // 1) Aynı sembol portföyde varsa cache'ten
      try {
        const list = await api.listAssets(portfolioId);
        const existing = list.find((a) => a.symbol === pickedHit.symbol.toUpperCase());
        if (existing) {
          const cached = await api.getCachedPrice(existing.id);
          if (!cancelled && cached && cached.price > 0) {
            setPrice(cached.price.toString());
          }
          if (!cancelled && existing.expected_yield_pct != null && yieldPct === "") {
            setYieldPct(existing.expected_yield_pct.toString());
          }
          if (!cancelled && price !== "") return;
        }
      } catch {}

      // 2) Mevcut asset/cache yoksa canlı fiyat çek
      try {
        if (pickedAssetType === "crypto") {
          const cgId = pickedHit.external_id ?? pickedHit.symbol.toLowerCase();
          const p = await api.fetchCryptoPrice(cgId);
          if (!cancelled && p.usd > 0) setPrice(p.usd.toString());
        } else if (pickedAssetType === "stock" || pickedAssetType === "commodity") {
          const sym = pickedHit.external_id ?? pickedHit.symbol;
          const p = await api.fetchStockPriceYahoo(sym);
          if (!cancelled && p.price > 0) setPrice(p.price.toString());
        }
      } catch {
        // sessizce başarısız — kullanıcı manuel girer
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, pickedHit?.symbol, pickedAssetType]);

  const onPickHit = (hit: SearchHit) => {
    saveRecentSearch(hit);
    setRecent(loadRecentSearches());
    setPickedHit(hit);
    const t: AssetTypeKey =
      hit.asset_type === "stock" ? "stock" : "crypto";
    setPickedAssetType(t);
    setPickedCurrency("USD");
    setStage("form");

    // Hisse ise Finnhub'tan dividend yield çek (key set'liyse) → form default
    if (t === "stock") {
      api
        .fetchStockProfile(hit.symbol)
        .then((profile) => {
          if (profile.dividend_yield_pct != null && yieldPct === "") {
            setYieldPct(profile.dividend_yield_pct.toFixed(2));
          }
        })
        .catch(() => {});
    }
  };

  const onPickManual = () => {
    const sym = manualSymbol.trim().toUpperCase();
    const nm = manualName.trim() || sym;
    if (!sym) {
      playSound("error");
      toast.error("Sembol gerekli");
      return;
    }
    setPickedHit({
      external_id: sym,
      symbol: sym,
      name: nm,
      icon: null,
      asset_type: "commodity",
      exchange: null,
    });
    setPickedAssetType("commodity");
    setPickedCurrency(manualCurrency.toUpperCase());
    setStage("form");
  };

  const triggerShake = () => {
    playSound("error");
    setShakeKey((k) => k + 1);
  };

  const resetFormForNext = () => {
    setQuantity("");
    setFee("");
    setNote("");
    setTags([]);
    setTagInput("");
    // price ve yield form üstünde, varlığa bağlı olduğu için korunabilir
    // ama yeni alımı genelde farklı fiyatla giriyor, temizleyelim:
    setPrice("");
    setDate(todayLocalDateInput());
    setShakeKey(0);
    setAdvancedOpen(false);
  };

  const submitFlow = async (continueAdding: boolean) => {
    if (!pickedHit) return;
    const qty = parseDecimal(quantity);
    const prc = parseDecimal(price);
    if (!Number.isFinite(qty) || qty <= 0) {
      triggerShake();
      toast.error("Miktar 0'dan büyük olmalı");
      return;
    }
    if (!Number.isFinite(prc) || prc <= 0) {
      triggerShake();
      toast.error("Fiyat 0'dan büyük olmalı");
      return;
    }
    const yieldVal = yieldPct.trim() === "" ? null : parseDecimal(yieldPct);
    if (yieldVal != null && (!Number.isFinite(yieldVal) || yieldVal < 0 || yieldVal > 1000)) {
      triggerShake();
      toast.error("Beklenen nakit akışı 0-1000% arasında olmalı");
      return;
    }
    const f = fee.trim() === "" ? 0 : parseDecimal(fee);

    setSubmitting(true);
    try {
      // Asset varsa bul, yoksa oluştur (UNIQUE conflict riski yok)
      const iconUrl =
        pickedHit.icon ??
        (pickedAssetType === "stock"
          ? `https://logo.clearbit.com/${guessDomainSlug(pickedHit.name, pickedHit.symbol)}.com`
          : null);
      const asset = await api.findOrCreateAsset({
        portfolioId,
        symbol: pickedHit.symbol,
        name: pickedHit.name || pickedHit.symbol,
        type: pickedAssetType,
        currency: pickedCurrency,
        externalId: pickedHit.external_id,
        iconUrl,
        expectedYieldPct: yieldVal,
        platform: platform.trim() || null,
      });

      // Sonraki açılışta default olsun
      const trimmedPlatform = platform.trim();
      if (trimmedPlatform) {
        try {
          localStorage.setItem(LAST_PLATFORM_KEY, trimmedPlatform);
        } catch {}
      }

      // Transaction'ı yaz
      await createTx({
        assetId: asset.id,
        date: dateInputToUnix(date),
        type: "buy", // varlık ekleme akışında ilk işlem her zaman alış
        source: null,
        quantity: qty,
        price: prc,
        fee: f,
        note: note.trim() || null,
        tags: tags.length > 0 ? tags : null,
      });

      // Yield güncelle (mevcut asset'in null'ı varsa veya kullanıcı override
      // ettiyse find_or_create_asset zaten halletti). Recompute + UI yenile.
      await refreshAssets(portfolioId);
      recompute(portfolioId, displayCurrency).catch(() => {});

      playSound("ding");
      toast.success(`${asset.symbol} • ${qty} adet alış kaydedildi`);
      celebrateSmall();

      if (continueAdding) {
        resetFormForNext();
      } else {
        closeModal();
      }
    } catch (err) {
      playSound("error");
      toast.error("Kaydedilemedi", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  };

  /* ============================================
   * Stage: SEARCH
   * ============================================ */
  if (stage === "search") {
    return (
      <ModalShell
        title="Varlık Ekle"
        description="Önce varlığı seç, sonra ilk alımının bilgilerini gir."
      >
        <Field label="Varlık tipi">
          <div className="grid grid-cols-4 gap-1.5 rounded-lg border border-(--color-border-subtle) bg-(--color-bg-base) p-1">
            {UI_PICKER.map(({ key, label }) => {
              const active = key === pickerType;
              const accent =
                key === "all"
                  ? "var(--color-accent)"
                  : assetTypeColor(key === "commodity" ? "commodity" : key);
              return (
                <button
                  key={key}
                  onClick={() => setPickerType(key)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium transition-all duration-150",
                    active
                      ? "bg-(--color-bg-hover) text-(--color-text-primary)"
                      : "text-(--color-text-secondary) hover:text-(--color-text-primary)"
                  )}
                  style={
                    active ? { boxShadow: `inset 0 -2px 0 ${accent}` } : undefined
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
        </Field>

        <div className="mt-5">
          {isAutocomplete ? (
            <Field
              label="Ara"
              hint={
                pickerType === "all"
                  ? "Kripto + hisse aynı anda — yazmaya başla"
                  : pickerType === "crypto"
                  ? "CoinGecko'dan ara (örn: bitcoin, eth, sol)"
                  : "Yahoo Finance'tan ara (örn: AAPL, NVDA, TSLA)"
              }
            >
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--color-text-tertiary)" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Yazmaya başla…"
                  className={cn(inputClass, "pl-9")}
                />
              </div>
            </Field>
          ) : (
            <div className="space-y-3">
              <Field
                label="Sembol"
                hint="USD, EUR, GBP, JPY, XAU (gram altın), CHF, CAD…"
              >
                <input
                  autoFocus
                  value={manualSymbol}
                  onChange={(e) => setManualSymbol(e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="İsim">
                <input
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  placeholder="örn: ABD Doları, Gram Altın"
                  className={inputClass}
                />
              </Field>
              <Field label="Para birimi" hint="TCMB üzerinden bu birimden TRY karşılığı çekilir">
                <input
                  value={manualCurrency}
                  onChange={(e) => setManualCurrency(e.target.value)}
                  className={inputClass}
                />
              </Field>
            </div>
          )}
        </div>

        {isAutocomplete && (
          <div className="mt-4 max-h-72 overflow-y-auto rounded-lg border border-(--color-border-subtle) bg-(--color-bg-base)">
            {searching && (
              <div className="space-y-2 p-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            )}
            {!searching && debounced.trim().length < 2 && (
              recent.length > 0 ? (
                <div>
                  <div className="border-b border-(--color-border-subtle) bg-(--color-bg-base)/40 px-4 py-2 text-[10px] font-medium tracking-[0.06em] text-(--color-text-tertiary) uppercase">
                    Son aranan
                  </div>
                  <ul>
                    {recent.map((h) => (
                      <li key={`recent-${h.asset_type}-${h.external_id}`}>
                        <button
                          onClick={() => onPickHit(h)}
                          className="flex w-full items-center gap-3 border-b border-(--color-border-subtle) px-4 py-2.5 text-left transition-colors last:border-b-0 hover:bg-(--color-bg-hover)"
                        >
                          <AssetIcon
                            symbol={h.symbol}
                            iconUrl={h.icon}
                            type={h.asset_type}
                            size={32}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium tabular">
                              {h.symbol}
                            </div>
                            <div className="truncate text-xs text-(--color-text-tertiary)">
                              {h.name}
                            </div>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="px-4 py-6 text-center text-sm text-(--color-text-tertiary)">
                  En az 2 karakter yaz, sonuçlar burada görünür.
                </p>
              )
            )}
            {!searching && debounced.trim().length >= 2 && hits.length === 0 && (
              <div className="px-4 py-6 text-center">
                <p className="text-sm text-(--color-text-tertiary)">
                  Aradığın sembol bulunamadı.
                </p>
                <p className="mt-1 text-xs text-(--color-text-tertiary)">
                  Sembolü biliyorsan direkt yaz — örn. <span className="tabular">MSFT</span>,{" "}
                  <span className="tabular">NVDA</span>, <span className="tabular">btc</span>.
                </p>
              </div>
            )}
            {!searching && hits.length > 0 && (
              <ul>
                {hits.map((h) => (
                  <li key={`${h.asset_type}-${h.external_id}`}>
                    <button
                      onClick={() => onPickHit(h)}
                      className="flex w-full items-center gap-3 border-b border-(--color-border-subtle) px-4 py-2.5 text-left transition-colors last:border-b-0 hover:bg-(--color-bg-hover)"
                    >
                      <AssetIcon
                        symbol={h.symbol}
                        iconUrl={h.icon}
                        type={h.asset_type}
                        size={28}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium tabular">{h.symbol}</span>
                          <span className="text-[10px] uppercase tracking-wide text-(--color-text-tertiary)">
                            {h.asset_type === "stock" ? "Hisse" : h.asset_type === "crypto" ? "Kripto" : ""}
                          </span>
                          {h.exchange && (
                            <span className="text-[11px] text-(--color-text-tertiary)">
                              {h.exchange}
                            </span>
                          )}
                        </div>
                        <p className="truncate text-xs text-(--color-text-secondary)">
                          {h.name}
                        </p>
                      </div>
                      <Plus className="h-4 w-4 shrink-0 text-(--color-text-tertiary)" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {!isAutocomplete && (
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={closeModal} className={buttonGhost}>
              İptal
            </button>
            <button onClick={onPickManual} className={buttonPrimary}>
              İleri
            </button>
          </div>
        )}
      </ModalShell>
    );
  }

  /* ============================================
   * Stage: FORM
   * ============================================ */
  return (
    <ModalShell
      title="İlk işlemi gir"
      description={pickedHit?.name ?? ""}
    >
      <div key={shakeKey} className={shakeKey > 0 ? "animate-shake" : ""}>
        {/* Asset header — geri butonu */}
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-(--color-border-subtle) bg-(--color-bg-base) px-3 py-2">
          <button
            onClick={() => setStage("search")}
            aria-label="Geri"
            className="text-(--color-text-tertiary) transition-colors hover:text-(--color-text-primary)"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <AssetIcon
            symbol={pickedHit?.symbol ?? ""}
            iconUrl={pickedHit?.icon ?? null}
            type={pickedAssetType}
            size={28}
          />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium tabular">{pickedHit?.symbol}</div>
            <div className="truncate text-xs text-(--color-text-tertiary)">
              {pickedHit?.name} • {pickedCurrency}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Miktar">
            <input
              autoFocus
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="örn: 0.5"
              className={inputClass}
            />
          </Field>
          <Field label={`Ortalama fiyat (${pickedCurrency})`}>
            <input
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="örn: 60000"
              className={inputClass}
            />
          </Field>
        </div>

        <div className="mt-4">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
              Nakit akışı
            </span>
            <span className="text-[11px] text-(--color-text-tertiary)">(opsiyonel)</span>
            <span className="group relative inline-flex" tabIndex={0}>
              <Info className="h-3 w-3 text-(--color-text-tertiary) hover:text-(--color-text-secondary) cursor-help" />
              <span className="pointer-events-none absolute left-1/2 top-full z-10 mt-1 w-60 -translate-x-1/2 rounded-md border border-(--color-border-subtle) bg-(--color-bg-panel) px-2.5 py-1.5 text-xs text-(--color-text-secondary) opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus:opacity-100">
                Bu varlık için yıllık beklediğin staking / faiz / temettü oranı (%).
                Varlık düzeyinde tutulur.
              </span>
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              inputMode="decimal"
              value={yieldPct}
              onChange={(e) => setYieldPct(e.target.value)}
              placeholder="örn: 5"
              className={cn(inputClass, "w-32")}
            />
            <span className="text-sm text-(--color-text-tertiary)">% / yıl</span>
          </div>
        </div>

        <div className="mt-3">
          <label className="text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
            Platform (opsiyonel)
          </label>
          <input
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            onFocus={() => setPlatformFocused(true)}
            onBlur={() => setPlatformFocused(false)}
            placeholder="örn: Binance, Kraken, İş Bankası"
            className={cn(inputClass, "mt-1.5")}
          />
          <AnimatePresence initial={false}>
            {platformFocused && knownPlatforms.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0, y: -4 }}
                animate={{ opacity: 1, height: "auto", y: 0 }}
                exit={{ opacity: 0, height: 0, y: -4 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <PlatformChipList
                  items={knownPlatforms}
                  value={platform}
                  onSelect={setPlatform}
                  expanded={platformExpanded}
                  onToggleExpand={() => setPlatformExpanded((v) => !v)}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="mt-4 rounded-lg border border-(--color-border-subtle) bg-(--color-bg-base)">
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="flex w-full items-center justify-between px-3 py-2 text-sm text-(--color-text-secondary) transition-colors hover:text-(--color-text-primary)"
          >
            <span>Gelişmiş</span>
            <motion.span
              animate={{ rotate: advancedOpen ? 180 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <ChevronDown className="h-4 w-4" />
            </motion.span>
          </button>
          <AnimatePresence initial={false}>
            {advancedOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <div className="space-y-3 border-t border-(--color-border-subtle) px-3 py-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Tarih">
                      <input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        max={todayLocalDateInput()}
                        className={inputClass}
                      />
                    </Field>
                    <Field label={`Ücret (${pickedCurrency})`}>
                      <input
                        inputMode="decimal"
                        value={fee}
                        onChange={(e) => setFee(e.target.value)}
                        placeholder="0"
                        className={inputClass}
                      />
                    </Field>
                  </div>
                  <Field label="Not">
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Etiketler" hint="Enter ile ekle. Örn: #uzun-vade">
                    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-(--color-border-subtle) bg-(--color-bg-panel) px-2 py-1.5">
                      {tags.map((t) => (
                        <span
                          key={t}
                          className="inline-flex items-center gap-1 rounded-md bg-(--color-bg-hover) px-2 py-0.5 text-xs text-(--color-text-primary)"
                        >
                          #{t}
                          <button
                            onClick={() => setTags(tags.filter((x) => x !== t))}
                            aria-label={`${t} kaldır`}
                            className="text-(--color-text-tertiary) hover:text-(--color-text-primary)"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                      <input
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            const t = tagInput.trim().replace(/^#/, "");
                            if (t && !tags.includes(t)) setTags([...tags, t]);
                            setTagInput("");
                          }
                        }}
                        placeholder={tags.length === 0 ? "etiket yaz, Enter…" : ""}
                        className="min-w-[8ch] flex-1 bg-transparent px-1 py-1 text-sm outline-none placeholder:text-(--color-text-tertiary)"
                      />
                    </div>
                  </Field>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button onClick={closeModal} className={buttonGhost}>
            İptal
          </button>
          <button
            onClick={() => submitFlow(true)}
            disabled={submitting}
            className={buttonSecondary}
          >
            Kaydet ve sonra ekle
          </button>
          <button
            onClick={() => submitFlow(false)}
            disabled={submitting}
            className={buttonPrimary}
          >
            Kaydet
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
