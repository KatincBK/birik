import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import { ChevronRight, ChevronDown, ArrowUp, ArrowDown, Trash2, Pencil, Plus, Building2, GripVertical } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useUIStore } from "../../stores/uiStore";
import { assetTypeLabel } from "../../lib/colors";
import { AssetIcon } from "../AssetIcon";
import { useAssetStore } from "../../stores/assetStore";
import { usePortfolioStore } from "../../stores/portfolioStore";
import { useStatsStore } from "../../stores/statsStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { playSound } from "../../lib/sounds";
import { cn } from "../../lib/cn";
import {
  formatCurrency,
  formatNumber,
  formatChange,
  changeClass,
} from "../../lib/format";
import { useFlashOnChange } from "../../hooks/useFlashOnChange";
import { api, type AssetStats } from "../../lib/api";
import { aggregateGroup } from "../../lib/groupAssets";
import { AddTransactionModal } from "../AddTransactionModal";
import { EditTransactionModal } from "../EditTransactionModal";
import { EditAssetPlatformModal } from "../EditAssetPlatformModal";

export type AssetTableHandle = {
  openFilters: () => void;
  openColumns: () => void;
};

export const AssetTable = forwardRef<
  AssetTableHandle,
  { assets: AssetStats[]; displayCurrency: string; groupBySymbol?: boolean }
>(function AssetTable({ assets, displayCurrency, groupBySymbol = false }, ref) {
  const goAsset = useUIStore((s) => s.goAsset);
  const openModal = useUIStore((s) => s.openModal);
  const removeAsset = useAssetStore((s) => s.remove);
  const recompute = useStatsStore((s) => s.recompute);
  const userDisplayCurrency = useSettingsStore((s) => s.displayCurrency);

  const [ctxMenu, setCtxMenu] = useState<
    | { assetId: number; symbol: string; portfolioId: number; x: number; y: number }
    | null
  >(null);

  type SortKey =
    | "symbol"
    | "platform"
    | "value"
    | "plAbs"
    | "plPct"
    | "daily"
    | "passiveAnnual";
  type SortDir = "asc" | "desc";
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "value",
    dir: "desc",
  });

  // Sütun görünürlük tercihleri — localStorage'da kalıcı
  type ColKey =
    | "platform"
    | "balance"
    | "avgCost"
    | "price"
    | "value"
    | "pl"
    | "daily"
    | "passiveAnnual";
  type ColVis = Record<ColKey, boolean>;
  const COL_LABELS: Record<ColKey, string> = {
    platform: "Platform",
    balance: "Miktar",
    avgCost: "Ort. Maliyet",
    price: "Güncel Fiyat",
    value: "Değer",
    pl: "Kar/Zarar",
    daily: "Günlük",
    passiveAnnual: "Pasif (yıl)",
  };
  const DEFAULT_COLS: ColVis = {
    platform: true,
    balance: true,
    avgCost: true,
    price: true,
    value: true,
    pl: true,
    daily: true,
    passiveAnnual: true,
  };
  const DEFAULT_ORDER: ColKey[] = [
    "platform",
    "balance",
    "avgCost",
    "price",
    "value",
    "daily",
    "pl",
    "passiveAnnual",
  ];
  const [cols, setCols] = useState<ColVis>(() => {
    try {
      const raw = localStorage.getItem("birik.assetColumns");
      if (raw) return { ...DEFAULT_COLS, ...JSON.parse(raw) };
    } catch {}
    return DEFAULT_COLS;
  });
  const [colOrder, setColOrder] = useState<ColKey[]>(() => {
    try {
      const raw = localStorage.getItem("birik.assetColumnsOrder");
      if (raw) {
        const parsed: ColKey[] = JSON.parse(raw);
        // Mevcut kolonları içerdiğinden emin ol, eksikleri sona ekle
        const set = new Set(parsed);
        const merged = parsed.filter((k) => DEFAULT_ORDER.includes(k));
        for (const k of DEFAULT_ORDER) if (!set.has(k)) merged.push(k);
        return merged;
      }
    } catch {}
    return DEFAULT_ORDER;
  });
  const [dragKey, setDragKey] = useState<ColKey | null>(null);
  const [colsOpen, setColsOpen] = useState(false);

  // Responsive: pencere genişliği küçüldükçe colOrder'ın sonundan başlayarak
  // sütunlar otomatik gizlenir. Kullanıcı sütun sırasını drag ile öncelik
  // belirler — en sağdaki gizlenir ilk.
  const [winWidth, setWinWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1600
  );
  useEffect(() => {
    const onResize = () => setWinWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const hideFromEnd = (() => {
    if (winWidth < 700) return colOrder.length; // sadece Varlık
    if (winWidth < 860) return 4;
    if (winWidth < 1020) return 3;
    if (winWidth < 1180) return 2;
    if (winWidth < 1340) return 1;
    return 0;
  })();
  const widthHidden = new Set(
    colOrder.slice(Math.max(0, colOrder.length - hideFromEnd))
  );
  const isVisible = (k: ColKey) => cols[k] && !widthHidden.has(k);
  useEffect(() => {
    if (!colsOpen) return;
    const close = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-cols-menu]")) setColsOpen(false);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [colsOpen]);
  const toggleCol = (k: ColKey) => {
    setCols((cur) => {
      const next = { ...cur, [k]: !cur[k] };
      try {
        localStorage.setItem("birik.assetColumns", JSON.stringify(next));
      } catch {}
      return next;
    });
  };
  const reorderCols = (dragged: ColKey, target: ColKey) => {
    if (dragged === target) return;
    setColOrder((cur) => {
      const list = cur.filter((k) => k !== dragged);
      const idx = list.indexOf(target);
      list.splice(idx, 0, dragged);
      try {
        localStorage.setItem("birik.assetColumnsOrder", JSON.stringify(list));
      } catch {}
      return list;
    });
  };

  // Filtreler
  const [plFilter, setPlFilter] = useState<"all" | "profit" | "loss">("all");
  const [platformFilter, setPlatformFilter] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  useEffect(() => {
    if (!filterOpen) return;
    const close = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-filter-menu]")) setFilterOpen(false);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [filterOpen]);

  // Platform listesi tamamen tx-derived (a.platforms) — buy/sell/passive_income
  // net qty > 0 olan platformlar. Asset-level `a.platform` artık otorite değil
  // (yalnızca yeni tx modal'ı için default değer). Grup satırında üyelerin
  // platformlarını birleştir.
  const allPlatformsOf = (a: AssetStats): Set<string> => {
    const set = new Set<string>();
    for (const p of a.platforms ?? []) if (p) set.add(p);
    if (a.members) {
      for (const m of a.members) {
        for (const p of m.platforms ?? []) if (p) set.add(p);
      }
    }
    return set;
  };

  const platformOptions = useMemo(() => {
    const set = new Set<string>();
    for (const a of assets) for (const p of allPlatformsOf(a)) set.add(p);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [assets]);
  const typeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const a of assets) set.add(a.asset_type);
    return [...set].sort();
  }, [assets]);
  const typeLabel: Record<string, string> = {
    crypto: "Kripto",
    stock: "Hisse",
    fx: "Döviz",
    commodity: "Emtia",
  };

  // Bir asset platforma uyuyor mu? Filtre yoksa hep true.
  // platformFilter içindeki "" sentinel'i "belirtilmemiş" anlamına gelir.
  const matchesPlatformFilter = (a: AssetStats): boolean => {
    if (platformFilter.size === 0) return true;
    const hits = allPlatformsOf(a);
    if (hits.size === 0 && platformFilter.has("")) return true;
    for (const p of hits) if (platformFilter.has(p)) return true;
    return false;
  };

  const hasUnassignedAssets = useMemo(
    () => assets.some((a) => allPlatformsOf(a).size === 0),
    [assets]
  );

  const filteredAssets = useMemo(() => {
    // 1) Önce ham asset listesini pl/tip filtresine sok.
    const prelim = assets.filter((a) => {
      if (plFilter === "profit" && (a.unrealized_pl_display ?? 0) <= 0) return false;
      if (plFilter === "loss" && (a.unrealized_pl_display ?? 0) >= 0) return false;
      if (typeFilter.size > 0 && !typeFilter.has(a.asset_type)) return false;
      return true;
    });

    // 2) Platform filtresini uygula. groupBySymbol açıksa, üyelerden de süz.
    let withPlatform: AssetStats[];
    if (platformFilter.size === 0) {
      withPlatform = prelim;
    } else if (!groupBySymbol) {
      withPlatform = prelim.filter(matchesPlatformFilter);
    } else {
      // "Hepsi" görünümü → her satır tek portföyden bir asset.
      // Sembol grubu daha sonra oluşturulduğu için burada düz filtre yeter.
      withPlatform = prelim.filter(matchesPlatformFilter);
    }

    // 3) Sembol bazında grupla (sadece "Hepsi" görünümünde).
    if (!groupBySymbol) return withPlatform;
    const map = new Map<string, AssetStats[]>();
    for (const a of withPlatform) {
      const key = `${a.symbol}|${a.asset_type}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    return [...map.values()].map(aggregateGroup);
  }, [assets, plFilter, platformFilter, typeFilter, groupBySymbol]);

  const togglePlatformFilter = (p: string) => {
    setPlatformFilter((cur) => {
      const next = new Set(cur);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };
  const toggleTypeFilter = (t: string) => {
    setTypeFilter((cur) => {
      const next = new Set(cur);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };
  const clearFilters = () => {
    setPlFilter("all");
    setPlatformFilter(new Set());
    setTypeFilter(new Set());
  };
  const activeFilterCount =
    (plFilter !== "all" ? 1 : 0) + platformFilter.size + typeFilter.size;

  useImperativeHandle(
    ref,
    () => ({
      openFilters: () => setFilterOpen(true),
      openColumns: () => setColsOpen(true),
    }),
    []
  );

  // "Hepsi" görünümünde grup satırları expand edilebilir
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
  const toggleExpand = (assetId: number) => {
    setExpandedGroups((cur) => {
      const next = new Set(cur);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  };

  // asset_id → portfolio name lookup (sub-row badge'leri için)
  const byPortfolioMap = useAssetStore((s) => s.byPortfolio);
  const portfoliosList = usePortfolioStore((s) => s.portfolios);
  const portfolioNameOf = (assetId: number): string => {
    for (const p of portfoliosList) {
      if ((byPortfolioMap[p.id] ?? []).some((a) => a.id === assetId)) {
        return p.name;
      }
    }
    return "—";
  };

  const sortedAssets = useMemo(() => {
    const list = [...filteredAssets];
    const factor = sort.dir === "asc" ? 1 : -1;
    const valOf = (a: AssetStats): string | number => {
      switch (sort.key) {
        case "symbol":
          return a.symbol.toUpperCase();
        case "platform": {
          const list = a.platforms ?? [];
          if (list.length === 0) return "￿"; // sona at
          if (list.length === 1) return list[0].toLowerCase();
          return "çeşitli";
        }
        case "value":
          return a.market_value_display ?? -Infinity;
        case "plAbs":
          return a.unrealized_pl_display ?? -Infinity;
        case "plPct":
          if (
            a.unrealized_pl_display == null ||
            a.total_cost_display <= 0
          )
            return -Infinity;
          return (a.unrealized_pl_display / a.total_cost_display) * 100;
        case "daily":
          if (a.market_value_display == null || a.price_change_24h_pct == null)
            return -Infinity;
          return (a.market_value_display * a.price_change_24h_pct) / 100;
        case "passiveAnnual":
          if (a.market_value_display == null || a.expected_yield_pct == null)
            return -Infinity;
          return (a.market_value_display * a.expected_yield_pct) / 100;
      }
    };
    list.sort((a, b) => {
      const va = valOf(a);
      const vb = valOf(b);
      if (typeof va === "string" && typeof vb === "string") {
        return factor * va.localeCompare(vb);
      }
      return factor * ((va as number) - (vb as number));
    });
    return list;
  }, [filteredAssets, sort]);

  const toggleSort = (key: SortKey) => {
    setSort((cur) => {
      if (cur.key === key) {
        return { key, dir: cur.dir === "asc" ? "desc" : "asc" };
      }
      // Yeni key — sayısal alanlar desc, metin alanlar asc default
      const isText = key === "symbol" || key === "platform";
      return { key, dir: isText ? "asc" : "desc" };
    });
  };

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [ctxMenu]);

  const onContextMenu = (
    e: React.MouseEvent,
    a: AssetStats
  ) => {
    e.preventDefault();
    e.stopPropagation();
    // assetId üzerinden portföy bul (asset.portfolio_id AssetStats'ta yok ama
    // store'dan bulabiliriz)
    const stored = useAssetStore.getState().get(a.asset_id);
    if (!stored) return;
    setCtxMenu({
      assetId: a.asset_id,
      symbol: a.symbol,
      portfolioId: stored.portfolio_id,
      x: e.clientX,
      y: e.clientY,
    });
  };

  const onDelete = async () => {
    if (!ctxMenu) return;
    const { assetId, symbol, portfolioId } = ctxMenu;
    if (
      !confirm(
        `"${symbol}" silinsin mi? Tüm işlemleri ve alarmları da silinecek. Geri alınamaz.`
      )
    ) {
      setCtxMenu(null);
      return;
    }
    try {
      await removeAsset(assetId, portfolioId);
      playSound("swoosh");
      recompute(portfolioId, userDisplayCurrency).catch(() => {});
      toast.success(`${symbol} silindi`);
    } catch (err) {
      playSound("error");
      toast.error("Silinemedi", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setCtxMenu(null);
    }
  };

  const onAdd = () => {
    if (!ctxMenu) return;
    const stored = useAssetStore.getState().get(ctxMenu.assetId);
    if (!stored) return;
    openModal(<AddTransactionModal asset={stored} />);
    setCtxMenu(null);
  };

  const onEditPlatform = () => {
    if (!ctxMenu) return;
    const stored = useAssetStore.getState().get(ctxMenu.assetId);
    if (!stored) return;
    openModal(<EditAssetPlatformModal asset={stored} />);
    setCtxMenu(null);
  };

  const onEdit = async () => {
    if (!ctxMenu) return;
    const { assetId } = ctxMenu;
    const stored = useAssetStore.getState().get(assetId);
    if (!stored) {
      setCtxMenu(null);
      return;
    }
    try {
      const txns = await api.listTransactions(assetId, false);
      setCtxMenu(null);
      if (txns.length === 0) {
        toast.info("Önce bir işlem ekle (sağ tık → Ekle)");
        return;
      }
      if (txns.length === 1) {
        openModal(<EditTransactionModal asset={stored} tx={txns[0]} />);
      } else {
        // Birden fazla işlem → varlık sayfasına götür
        goAsset(assetId);
      }
    } catch (err) {
      playSound("error");
      toast.error("İşlemler yüklenemedi", {
        description: err instanceof Error ? err.message : String(err),
      });
      setCtxMenu(null);
    }
  };

  if (assets.length === 0) {
    return (
      <div className="rounded-xl border border-(--color-border-subtle) bg-(--color-bg-panel) px-6 py-12 text-center">
        <p className="text-sm text-(--color-text-secondary)">
          İlk varlığını ekleyince liste burada canlanır.
        </p>
      </div>
    );
  }

  return (
    <div className="relative rounded-xl border border-(--color-border-subtle) bg-(--color-bg-panel)">
      {/* Filtre paneli — dış buton (Dashboard) tarafından açılır */}
      <div className="absolute right-2 top-2 z-10" data-filter-menu>
        {filterOpen && (
          <div
            className="absolute right-0 top-full mt-1 w-64 overflow-hidden rounded-lg border border-(--color-border-subtle) bg-(--color-bg-panel) p-3 text-sm shadow-2xl shadow-black/50"
            onClick={(e) => e.stopPropagation()}
          >
            {/* PL durumu */}
            <div className="mb-3">
              <div className="mb-1.5 text-[10px] font-medium tracking-[0.06em] text-(--color-text-tertiary) uppercase">
                Pozisyon
              </div>
              <div className="flex gap-1 rounded-md border border-(--color-border-subtle) bg-(--color-bg-base) p-0.5">
                {(
                  [
                    { k: "all", l: "Hepsi" },
                    { k: "profit", l: "Karda" },
                    { k: "loss", l: "Zararda" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.k}
                    onClick={() => setPlFilter(opt.k)}
                    className={cn(
                      "flex-1 rounded px-2 py-1 text-[11px] font-medium transition-colors",
                      plFilter === opt.k
                        ? "bg-(--color-accent)/15 text-(--color-accent)"
                        : "text-(--color-text-secondary) hover:text-(--color-text-primary)"
                    )}
                  >
                    {opt.l}
                  </button>
                ))}
              </div>
            </div>

            {/* Tip */}
            {typeOptions.length > 0 && (
              <div className="mb-3">
                <div className="mb-1.5 text-[10px] font-medium tracking-[0.06em] text-(--color-text-tertiary) uppercase">
                  Varlık tipi
                </div>
                <div className="flex flex-wrap gap-1">
                  {typeOptions.map((t) => (
                    <button
                      key={t}
                      onClick={() => toggleTypeFilter(t)}
                      className={cn(
                        "rounded-md border px-2 py-0.5 text-[11px] transition-colors",
                        typeFilter.has(t)
                          ? "border-(--color-accent)/40 bg-(--color-accent)/15 text-(--color-accent)"
                          : "border-(--color-border-subtle) bg-(--color-bg-base) text-(--color-text-secondary) hover:border-(--color-accent)/40 hover:text-(--color-accent)"
                      )}
                    >
                      {typeLabel[t] ?? t}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Platform */}
            {(platformOptions.length > 0 || hasUnassignedAssets) && (
              <div className="mb-3">
                <div className="mb-1.5 text-[10px] font-medium tracking-[0.06em] text-(--color-text-tertiary) uppercase">
                  Platform
                </div>
                <div className="flex flex-wrap gap-1">
                  {platformOptions.map((p) => (
                    <button
                      key={p}
                      onClick={() => togglePlatformFilter(p)}
                      className={cn(
                        "rounded-md border px-2 py-0.5 text-[11px] transition-colors",
                        platformFilter.has(p)
                          ? "border-(--color-accent)/40 bg-(--color-accent)/15 text-(--color-accent)"
                          : "border-(--color-border-subtle) bg-(--color-bg-base) text-(--color-text-secondary) hover:border-(--color-accent)/40 hover:text-(--color-accent)"
                      )}
                    >
                      {p}
                    </button>
                  ))}
                  {hasUnassignedAssets && (
                    <button
                      onClick={() => togglePlatformFilter("")}
                      className={cn(
                        "rounded-md border px-2 py-0.5 text-[11px] italic transition-colors",
                        platformFilter.has("")
                          ? "border-(--color-accent)/40 bg-(--color-accent)/15 text-(--color-accent)"
                          : "border-dashed border-(--color-border-subtle) bg-(--color-bg-base) text-(--color-text-tertiary) hover:border-(--color-accent)/40 hover:text-(--color-accent)"
                      )}
                    >
                      Belirtilmemiş
                    </button>
                  )}
                </div>
              </div>
            )}

            {activeFilterCount > 0 && (
              <button
                onClick={clearFilters}
                className="mt-1 w-full rounded-md border border-(--color-border-subtle) bg-(--color-bg-base) px-2 py-1 text-[11px] text-(--color-text-secondary) transition-colors hover:text-(--color-text-primary)"
              >
                Temizle
              </button>
            )}
          </div>
        )}
      </div>

      {/* Sütun düzenle paneli — dış buton (Dashboard) tarafından açılır */}
      <div className="absolute right-2 top-2 z-10" data-cols-menu>
        {colsOpen && (
          <div className="absolute right-0 top-full mt-1 min-w-[200px] overflow-hidden rounded-lg border border-(--color-border-subtle) bg-(--color-bg-panel) py-1 text-sm shadow-2xl shadow-black/50">
            <div className="px-3 pb-1 pt-0.5 text-[10px] tracking-wide text-(--color-text-tertiary) uppercase">
              Tut & sürükle sıralama
            </div>
            {colOrder.map((k) => (
              <div
                key={k}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", k);
                  setDragKey(k);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const dropped = e.dataTransfer.getData("text/plain") as ColKey;
                  if (dropped && dropped !== k) reorderCols(dropped, k);
                  setDragKey(null);
                }}
                onDragEnd={() => setDragKey(null)}
                className={cn(
                  "flex select-none items-center gap-2 px-2 py-1.5 transition-colors",
                  dragKey === k
                    ? "bg-(--color-accent)/10"
                    : "hover:bg-(--color-bg-hover)"
                )}
              >
                <GripVertical
                  className="h-3.5 w-3.5 shrink-0 cursor-grab text-(--color-text-tertiary)"
                />
                <label className="flex flex-1 cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={cols[k]}
                    onChange={() => toggleCol(k)}
                    className="h-3.5 w-3.5 accent-(--color-accent)"
                  />
                  <span className="text-(--color-text-primary)">
                    {COL_LABELS[k]}
                  </span>
                </label>
              </div>
            ))}
          </div>
        )}
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-(--color-border-subtle) bg-(--color-bg-base)/40 text-(--color-text-tertiary)">
            <Th sortKey="symbol" sort={sort} onSort={toggleSort}>Varlık</Th>
            {colOrder.map((k) => {
              if (!isVisible(k)) return null;
              switch (k) {
                case "platform":
                  return (
                    <Th key={k} sortKey="platform" sort={sort} onSort={toggleSort}>
                      Platform
                    </Th>
                  );
                case "balance":
                  return <Th key={k} align="right">Miktar</Th>;
                case "avgCost":
                  return <Th key={k} align="right">Ort. Maliyet</Th>;
                case "price":
                  return <Th key={k} align="right">Güncel Fiyat</Th>;
                case "value":
                  return (
                    <Th key={k} sortKey="value" sort={sort} onSort={toggleSort} align="right">
                      Değer
                    </Th>
                  );
                case "pl":
                  return (
                    <Th key={k} sortKey="plAbs" sort={sort} onSort={toggleSort} align="right">
                      Kar/Zarar
                    </Th>
                  );
                case "daily":
                  return (
                    <Th key={k} sortKey="daily" sort={sort} onSort={toggleSort} align="right">
                      Günlük
                    </Th>
                  );
                case "passiveAnnual":
                  return (
                    <Th key={k} sortKey="passiveAnnual" sort={sort} onSort={toggleSort} align="right">
                      Pasif (yıl)
                    </Th>
                  );
              }
            })}
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {sortedAssets.flatMap((a) => {
            const isGroup = (a.members?.length ?? 0) > 1;
            const expanded = expandedGroups.has(a.asset_id);
            const rows = [
              <AssetRow
                key={a.asset_id}
                a={a}
                displayCurrency={displayCurrency}
                cols={cols}
                colOrder={colOrder}
                widthHidden={widthHidden}
                isGroup={isGroup}
                expanded={expanded}
                onClick={() =>
                  isGroup ? toggleExpand(a.asset_id) : goAsset(a.asset_id)
                }
                onContextMenu={(e) => onContextMenu(e, a)}
              />,
            ];
            if (isGroup && expanded && a.members) {
              for (const m of a.members) {
                rows.push(
                  <AssetRow
                    key={`sub-${m.asset_id}`}
                    a={m}
                    displayCurrency={displayCurrency}
                    cols={cols}
                    colOrder={colOrder}
                    widthHidden={widthHidden}
                    subPortfolioName={portfolioNameOf(m.asset_id)}
                    onClick={() => goAsset(m.asset_id)}
                    onContextMenu={(e) => onContextMenu(e, m)}
                  />
                );
              }
            }
            return rows;
          })}
        </tbody>
      </table>

      {ctxMenu && (
        <div
          className="fixed z-50 min-w-[180px] overflow-hidden rounded-lg border border-(--color-border-subtle) bg-(--color-bg-panel) py-1 text-sm shadow-2xl shadow-black/50"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={onAdd}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-(--color-text-primary) transition-colors hover:bg-(--color-bg-hover)"
          >
            <Plus className="h-3.5 w-3.5" />
            İşlem ekle
          </button>
          <button
            onClick={onEdit}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-(--color-text-primary) transition-colors hover:bg-(--color-bg-hover)"
          >
            <Pencil className="h-3.5 w-3.5" />
            İşlemi düzenle
          </button>
          <button
            onClick={onEditPlatform}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-(--color-text-primary) transition-colors hover:bg-(--color-bg-hover)"
          >
            <Building2 className="h-3.5 w-3.5" />
            Platform düzenle
          </button>
          <div className="my-1 border-t border-(--color-border-subtle)" />
          <button
            onClick={onDelete}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors",
              "text-(--color-danger) hover:bg-(--color-danger)/10"
            )}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Varlığı sil
          </button>
        </div>
      )}
    </div>
  );
});

type AssetRowColKey =
  | "platform"
  | "balance"
  | "avgCost"
  | "price"
  | "value"
  | "pl"
  | "daily"
  | "passiveAnnual";

function AssetRow({
  a,
  displayCurrency,
  cols,
  colOrder,
  widthHidden,
  isGroup,
  expanded,
  subPortfolioName,
  onClick,
  onContextMenu,
}: {
  a: AssetStats;
  displayCurrency: string;
  cols: Record<AssetRowColKey, boolean>;
  colOrder: AssetRowColKey[];
  widthHidden: Set<AssetRowColKey>;
  isGroup?: boolean;
  expanded?: boolean;
  subPortfolioName?: string;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const flashDir = useFlashOnChange(a.current_price ?? null, 600);

  const flashClass =
    flashDir === "up"
      ? "bg-(--color-success)/10"
      : flashDir === "down"
      ? "bg-(--color-danger)/10"
      : "";

  const pct =
    a.unrealized_pl_display != null && a.total_cost_display > 0
      ? (a.unrealized_pl_display / a.total_cost_display) * 100
      : null;

  return (
    <motion.tr
      onClick={onClick}
      onContextMenu={onContextMenu}
      whileHover={{ backgroundColor: "rgba(255,255,255,0.03)" }}
      transition={{ duration: 0.15 }}
      className="cursor-pointer border-b border-(--color-border-subtle) last:border-b-0"
    >
      <Td className={subPortfolioName ? "pl-10" : undefined}>
        <div className="flex items-center gap-2.5">
          {isGroup ? (
            expanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-(--color-text-tertiary)" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-(--color-text-tertiary)" />
            )
          ) : null}
          <AssetIcon
            symbol={a.symbol}
            iconUrl={a.icon_url}
            type={a.asset_type}
            size={subPortfolioName ? 24 : 32}
          />
          <div>
            <div className="flex items-center gap-1.5">
              <span className={cn("font-medium tabular", subPortfolioName && "text-sm")}>
                {a.symbol}
              </span>
              {subPortfolioName && (
                <span className="rounded bg-(--color-bg-base) px-1.5 py-0.5 text-[10px] font-medium text-(--color-text-secondary)">
                  {subPortfolioName}
                </span>
              )}
              {isGroup && (
                <span className="rounded bg-(--color-bg-base) px-1.5 py-0.5 text-[10px] font-medium text-(--color-text-tertiary)">
                  {a.members?.length} portföy
                </span>
              )}
            </div>
            <div className="text-xs text-(--color-text-tertiary)">
              {assetTypeLabel(a.asset_type)} • {a.name}
            </div>
          </div>
        </div>
      </Td>
      {colOrder.map((k) => {
        if (!cols[k] || widthHidden.has(k)) return null;
        switch (k) {
          case "platform":
            return (
              <Td key={k}>
                {(() => {
                  const list = a.platforms ?? [];
                  if (list.length === 0) {
                    return <span className="text-xs text-(--color-text-tertiary)">—</span>;
                  }
                  const label =
                    list.length === 1 ? list[0] : `Çeşitli (${list.length})`;
                  return (
                    <span
                      className="rounded bg-(--color-bg-base) px-1.5 py-0.5 text-[11px] font-medium tracking-wide text-(--color-text-secondary)"
                      title={list.join(", ")}
                    >
                      {label}
                    </span>
                  );
                })()}
              </Td>
            );
          case "balance":
            return (
              <Td key={k} align="right" className="tabular">
                {formatNumber(a.balance, "detail")}
              </Td>
            );
          case "avgCost":
            return (
              <Td key={k} align="right" className="tabular text-(--color-text-secondary)">
                {a.balance > 0 && a.avg_cost > 0
                  ? formatCurrency(a.avg_cost, a.asset_currency, "summary")
                  : "—"}
              </Td>
            );
          case "price":
            return (
              <Td
                key={k}
                align="right"
                className={["tabular transition-colors duration-300", flashClass].join(" ")}
              >
                {a.current_price != null && a.price_currency ? (
                  <div className="flex flex-col items-end">
                    <span className="inline-flex items-center justify-end gap-1">
                      {flashDir === "up" && (
                        <ArrowUp className="h-3 w-3 text-(--color-success)" />
                      )}
                      {flashDir === "down" && (
                        <ArrowDown className="h-3 w-3 text-(--color-danger)" />
                      )}
                      {formatCurrency(a.current_price, a.price_currency, "summary")}
                    </span>
                    {a.price_change_24h_pct != null && (
                      <span className={`text-[11px] ${changeClass(a.price_change_24h_pct)}`}>
                        {a.price_change_24h_pct > 0 ? "+" : ""}
                        {a.price_change_24h_pct.toFixed(2)}%{" "}
                        <span className="text-(--color-text-tertiary)">24s</span>
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-(--color-text-tertiary)">—</span>
                )}
              </Td>
            );
          case "value":
            return (
              <Td key={k} align="right" className="tabular font-medium">
                {a.market_value_display != null
                  ? formatCurrency(a.market_value_display, displayCurrency, "summary")
                  : <span className="text-(--color-text-tertiary)">—</span>}
              </Td>
            );
          case "pl":
            return (
              <Td key={k} align="right" className="tabular">
                {a.unrealized_pl_display != null ? (
                  <div className={changeClass(a.unrealized_pl_display)}>
                    <div>{formatChange(a.unrealized_pl_display, displayCurrency, "summary")}</div>
                    {pct != null && (
                      <div className="text-xs">
                        {pct > 0 ? "+" : ""}
                        {pct.toFixed(2)}%
                      </div>
                    )}
                  </div>
                ) : (
                  <span className="text-(--color-text-tertiary)">—</span>
                )}
              </Td>
            );
          case "daily": {
            if (a.market_value_display == null || a.price_change_24h_pct == null) {
              return (
                <Td key={k} align="right" className="tabular">
                  <span className="text-(--color-text-tertiary)">—</span>
                </Td>
              );
            }
            const dailyAbs = (a.market_value_display * a.price_change_24h_pct) / 100;
            return (
              <Td key={k} align="right" className="tabular">
                <div className={changeClass(dailyAbs)}>
                  <div>{formatChange(dailyAbs, displayCurrency, "summary")}</div>
                  <div className="text-xs">
                    {a.price_change_24h_pct > 0 ? "+" : ""}
                    {a.price_change_24h_pct.toFixed(2)}%
                  </div>
                </div>
              </Td>
            );
          }
          case "passiveAnnual": {
            if (a.market_value_display == null || a.expected_yield_pct == null) {
              return (
                <Td key={k} align="right" className="tabular">
                  <span className="text-(--color-text-tertiary)">—</span>
                </Td>
              );
            }
            const annual = (a.market_value_display * a.expected_yield_pct) / 100;
            return (
              <Td key={k} align="right" className="tabular text-(--color-accent)">
                <div>{formatCurrency(annual, displayCurrency, "summary")}</div>
                <div className="text-xs text-(--color-text-tertiary)">
                  ≈ {a.expected_yield_pct.toFixed(2)}%
                </div>
              </Td>
            );
          }
        }
      })}
      <Td>
        <ChevronRight className="h-4 w-4 text-(--color-text-tertiary)" />
      </Td>
    </motion.tr>
  );
}

function Th({
  children,
  align,
  sortKey,
  sort,
  onSort,
}: {
  children: React.ReactNode;
  align?: "right";
  sortKey?: "symbol" | "platform" | "value" | "plAbs" | "plPct" | "daily" | "passiveAnnual";
  sort?: { key: string; dir: "asc" | "desc" };
  onSort?: (key: "symbol" | "platform" | "value" | "plAbs" | "plPct" | "daily" | "passiveAnnual") => void;
}) {
  const sortable = !!sortKey && !!onSort;
  const active = sort?.key === sortKey;
  return (
    <th
      onClick={sortable ? () => onSort!(sortKey!) : undefined}
      className={[
        "px-4 py-2.5 text-[11px] tracking-[0.05em] uppercase transition-colors",
        align === "right" ? "text-right" : "text-left",
        sortable
          ? active
            ? "cursor-pointer select-none font-semibold text-(--color-accent)"
            : "cursor-pointer select-none font-medium text-(--color-accent) hover:text-(--color-accent-hover)"
          : "font-medium text-(--color-text-tertiary)",
      ].join(" ")}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {sortable && active && (
          <span className="text-[9px]">{sort?.dir === "asc" ? "▲" : "▼"}</span>
        )}
      </span>
    </th>
  );
}

function Td({
  children,
  align,
  className,
}: {
  children: React.ReactNode;
  align?: "right";
  className?: string;
}) {
  return (
    <td
      className={[
        "px-4 py-3",
        align === "right" ? "text-right" : "text-left",
        className ?? "",
      ].join(" ")}
    >
      {children}
    </td>
  );
}
