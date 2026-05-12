import { useEffect, useMemo, useState } from "react";
import { ChevronRight, ArrowUp, ArrowDown, Trash2, Pencil, Plus, Building2, Columns3, GripVertical } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useUIStore } from "../../stores/uiStore";
import { assetTypeLabel } from "../../lib/colors";
import { AssetIcon } from "../AssetIcon";
import { useAssetStore } from "../../stores/assetStore";
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
import { AddTransactionModal } from "../AddTransactionModal";
import { EditTransactionModal } from "../EditTransactionModal";
import { EditAssetPlatformModal } from "../EditAssetPlatformModal";

export function AssetTable({
  assets,
  displayCurrency,
}: {
  assets: AssetStats[];
  displayCurrency: string;
}) {
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

  const sortedAssets = useMemo(() => {
    const list = [...assets];
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
  }, [assets, sort]);

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
      {/* Sütun toggle — sağ üst köşede */}
      <div className="absolute right-2 top-2 z-10" data-cols-menu>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setColsOpen((v) => !v);
          }}
          className="rounded-md border border-(--color-border-subtle) bg-(--color-bg-base) p-1 text-(--color-text-tertiary) transition-colors hover:text-(--color-text-primary)"
          title="Sütunları düzenle"
        >
          <Columns3 className="h-3.5 w-3.5" />
        </button>
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
          {sortedAssets.map((a) => (
            <AssetRow
              key={a.asset_id}
              a={a}
              displayCurrency={displayCurrency}
              cols={cols}
              colOrder={colOrder}
              widthHidden={widthHidden}
              onClick={() => goAsset(a.asset_id)}
              onContextMenu={(e) => onContextMenu(e, a)}
            />
          ))}
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
}

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
  onClick,
  onContextMenu,
}: {
  a: AssetStats;
  displayCurrency: string;
  cols: Record<AssetRowColKey, boolean>;
  colOrder: AssetRowColKey[];
  widthHidden: Set<AssetRowColKey>;
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
      <Td>
        <div className="flex items-center gap-2.5">
          <AssetIcon
            symbol={a.symbol}
            iconUrl={a.icon_url}
            type={a.asset_type}
            size={32}
          />
          <div>
            <div className="font-medium tabular">{a.symbol}</div>
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
  sortKey?: "symbol" | "platform" | "value" | "plAbs" | "plPct";
  sort?: { key: string; dir: "asc" | "desc" };
  onSort?: (key: "symbol" | "platform" | "value" | "plAbs" | "plPct") => void;
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
