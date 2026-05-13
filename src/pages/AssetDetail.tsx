import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Plus, Trash2, X, Pencil, Bell, Columns3, GripVertical } from "lucide-react";
import { toast } from "sonner";
import { useAssetStore } from "../stores/assetStore";
import { useTransactionStore } from "../stores/transactionStore";
import { useStatsStore, statsKey } from "../stores/statsStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useUIStore } from "../stores/uiStore";
import { AddTransactionModal } from "../components/AddTransactionModal";
import { EditTransactionModal } from "../components/EditTransactionModal";
import { CreateAlertModal } from "../components/CreateAlertModal";
import { Skeleton } from "../components/Skeleton";
import { buttonPrimary, buttonGhost } from "../components/Modal";
import { AssetIcon } from "../components/AssetIcon";
import { PriceChart } from "../components/charts/PriceChart";
import { EditAssetPlatformModal } from "../components/EditAssetPlatformModal";
import { playSound } from "../lib/sounds";
import { assetTypeLabel } from "../lib/colors";
import { api, type Transaction } from "../lib/api";
import { cn } from "../lib/cn";

// Stable boş referans — Zustand selector içinde `?? []` her render'da
// yeni dizi yaratıp sonsuz re-render'a yol açardı.
const EMPTY_TXNS: Transaction[] = [];
import {
  formatCurrency,
  formatNumber,
  formatChange,
  changeClass,
  formatDate,
  formatRelative,
} from "../lib/format";

export function AssetDetail({ assetId }: { assetId: number }) {
  const goBack = useUIStore((s) => s.goDashboard);
  const openModal = useUIStore((s) => s.openModal);

  const asset = useAssetStore((s) => s.get(assetId));

  const txns = useTransactionStore((s) => s.byAsset[assetId] ?? EMPTY_TXNS);
  const refreshTxns = useTransactionStore((s) => s.refresh);
  const softDelete = useTransactionStore((s) => s.softDelete);
  const restoreTx = useTransactionStore((s) => s.restore);
  const txLoading = useTransactionStore((s) => s.loading[assetId] ?? false);

  const [tags, setTags] = useState<string[]>([]);
  const [activeTag, setActiveTag] = useState<string | null>(null);

  useEffect(() => {
    api.listTransactionTags(assetId).then(setTags).catch(() => setTags([]));
  }, [assetId, txns.length]);

  // Etiket filtre backend'de — tag tıklayınca ayrı fetch + lokal state.
  // transaction_tags ayrı tabloda olduğu için frontend'de filtre yapmıyoruz.
  const [taggedTxns, setTaggedTxns] = useState<Transaction[] | null>(null);
  useEffect(() => {
    if (!activeTag) {
      setTaggedTxns(null);
      return;
    }
    api
      .listTransactions(assetId, false, activeTag)
      .then(setTaggedTxns)
      .catch(() => setTaggedTxns([]));
  }, [activeTag, assetId, txns.length]);
  const visibleTxns = activeTag ? (taggedTxns ?? []) : txns;

  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const stats = useStatsStore((s) =>
    asset ? s.byPortfolio[statsKey(asset.portfolio_id, displayCurrency)] ?? null : null
  );
  const recompute = useStatsStore((s) => s.recompute);

  // Asset detayında recompute her zaman tek-portföy modunda olur.
  const recomputeOwner = () =>
    asset
      ? recompute(asset.portfolio_id, displayCurrency).catch(() => {})
      : Promise.resolve();

  // İlk yüklemede varlığı garantile (dashboard'dan girilmediyse)
  useEffect(() => {
    if (!asset) {
      // Hangi portföyde olduğunu bilmiyoruz — tüm portföyleri tarayan bir yardımcı
      // şu an yok. Asset elimizde değilse dashboard'a dön.
      goBack();
    }
  }, [asset, goBack]);

  useEffect(() => {
    refreshTxns(assetId).catch(() => {});
  }, [assetId, refreshTxns]);

  const assetStats = useMemo(
    () => stats?.assets.find((a) => a.asset_id === assetId) ?? null,
    [stats, assetId]
  );

  // Transaction tablosu sütun yönetimi (AssetTable pattern'ine paralel)
  type TxColKey = "type" | "qty" | "price" | "fee" | "platform" | "yield" | "note";
  const TX_COL_LABELS: Record<TxColKey, string> = {
    type: "Tip",
    qty: "Miktar",
    price: "Birim Fiyat",
    fee: "Ücret",
    platform: "Platform",
    yield: "Yield",
    note: "Not",
  };
  const TX_DEFAULT_COLS: Record<TxColKey, boolean> = {
    type: true,
    qty: true,
    price: true,
    fee: true,
    platform: true,
    yield: true,
    note: true,
  };
  const TX_DEFAULT_ORDER: TxColKey[] = [
    "type",
    "qty",
    "price",
    "fee",
    "platform",
    "yield",
    "note",
  ];
  const [txCols, setTxCols] = useState<Record<TxColKey, boolean>>(() => {
    try {
      const raw = localStorage.getItem("birik.txColumns");
      if (raw) return { ...TX_DEFAULT_COLS, ...JSON.parse(raw) };
    } catch {}
    return TX_DEFAULT_COLS;
  });
  const [txColOrder, setTxColOrder] = useState<TxColKey[]>(() => {
    try {
      const raw = localStorage.getItem("birik.txColumnsOrder");
      if (raw) {
        const parsed: TxColKey[] = JSON.parse(raw);
        const set = new Set(parsed);
        const merged = parsed.filter((k) => TX_DEFAULT_ORDER.includes(k));
        for (const k of TX_DEFAULT_ORDER) if (!set.has(k)) merged.push(k);
        return merged;
      }
    } catch {}
    return TX_DEFAULT_ORDER;
  });
  const [txColsOpen, setTxColsOpen] = useState(false);
  const [txDragKey, setTxDragKey] = useState<TxColKey | null>(null);
  useEffect(() => {
    if (!txColsOpen) return;
    const close = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-tx-cols-menu]")) setTxColsOpen(false);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [txColsOpen]);
  const toggleTxCol = (k: TxColKey) => {
    setTxCols((cur) => {
      const next = { ...cur, [k]: !cur[k] };
      try {
        localStorage.setItem("birik.txColumns", JSON.stringify(next));
      } catch {}
      return next;
    });
  };
  const reorderTxCols = (dragged: TxColKey, target: TxColKey) => {
    if (dragged === target) return;
    setTxColOrder((cur) => {
      const list = cur.filter((k) => k !== dragged);
      const idx = list.indexOf(target);
      list.splice(idx, 0, dragged);
      try {
        localStorage.setItem("birik.txColumnsOrder", JSON.stringify(list));
      } catch {}
      return list;
    });
  };

  // Platform başına balance — transactions'tan derive
  const platformBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of txns) {
      if (t.is_deleted) continue;
      const key = t.platform?.trim() || "—";
      const delta =
        t.type === "buy"
          ? t.quantity
          : t.type === "sell"
          ? -t.quantity
          : t.quantity; // passive_income → ekle
      map.set(key, (map.get(key) ?? 0) + delta);
    }
    return [...map.entries()]
      .filter(([, v]) => Math.abs(v) > 1e-9)
      .sort((a, b) => b[1] - a[1]);
  }, [txns]);

  if (!asset) return null;

  const onAddTx = () => openModal(<AddTransactionModal asset={asset} />);

  const onDeleteTx = async (id: number) => {
    try {
      await softDelete(id, asset.id);
      playSound("swoosh");
      recomputeOwner();
      const deletedId = id;

      // PLAN §6.2: 5 sn'lik undo penceresi içinde geri al → restore;
      // pencere dolarsa hard delete (DB'den fiilen sil). Geri alındıysa
      // restore çağrısı zaten işlemi gör, hard delete'i atlamalıyız.
      let restored = false;
      const t = setTimeout(async () => {
        if (restored) return;
        try {
          await api.hardDeleteTransaction(deletedId);
        } catch {
          // Soft delete kalsa bile UI tutarlı (filter is_deleted=0)
        }
      }, 5000);

      toast("İşlem silindi", {
        action: {
          label: "Geri al",
          onClick: async () => {
            restored = true;
            clearTimeout(t);
            await restoreTx(deletedId, asset.id);
            playSound("ding");
            recomputeOwner();
            toast.success("İşlem geri yüklendi");
          },
        },
        duration: 5000,
      });
    } catch (err) {
      playSound("error");
      toast.error("Silme başarısız", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      {/* Geri */}
      <button
        onClick={goBack}
        className={`${buttonGhost} inline-flex items-center gap-1.5 -ml-3`}
      >
        <ArrowLeft className="h-4 w-4" />
        Dashboard'a dön
      </button>

      {/* Hero */}
      <header className="flex items-start gap-4">
        <AssetIcon
          symbol={asset.symbol}
          iconUrl={asset.icon_url}
          type={asset.type}
          size={56}
        />
        <div className="flex-1">
          <div className="flex items-baseline gap-2">
            <h1 className="text-3xl font-semibold tracking-tight tabular">
              {asset.symbol}
            </h1>
            <span className="text-sm text-(--color-text-secondary)">
              {asset.name}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-(--color-text-tertiary)">
            <span>{assetTypeLabel(asset.type)} • {asset.currency}</span>
            <button
              onClick={() => openModal(<EditAssetPlatformModal asset={asset} />)}
              className="rounded bg-(--color-bg-base) px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-(--color-text-secondary) transition-colors hover:bg-(--color-bg-hover) hover:text-(--color-text-primary)"
              title="Platform düzenle"
            >
              {asset.platform ?? "+ platform"}
            </button>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
            Güncel fiyat
          </div>
          <div className="text-2xl font-semibold tabular">
            {assetStats?.current_price != null && assetStats.price_currency
              ? formatCurrency(assetStats.current_price, assetStats.price_currency, "summary")
              : <span className="text-(--color-text-tertiary)">—</span>}
          </div>
          {assetStats?.price_fetched_at && (
            <div className="text-[11px] text-(--color-text-tertiary)">
              {formatRelative(assetStats.price_fetched_at)}
            </div>
          )}
          <button
            onClick={() =>
              openModal(
                <CreateAlertModal
                  presetAssetId={asset.id}
                  onCreated={() => {}}
                />
              )
            }
            className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-(--color-border-subtle) bg-(--color-bg-panel) px-2 py-1 text-xs text-(--color-text-secondary) transition-colors hover:border-(--color-border-strong) hover:text-(--color-text-primary)"
          >
            <Bell className="h-3 w-3" />
            Alarm kur
          </button>
        </div>
      </header>

      {/* Toplam değer + yıllık pasif gelir özet barı */}
      {assetStats && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-(--color-border-subtle) bg-(--color-bg-panel) px-5 py-4">
            <div className="text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
              Toplam değer
            </div>
            <div className="mt-1 text-3xl font-semibold tabular tracking-tight">
              {assetStats.market_value_display != null ? (
                formatCurrency(
                  assetStats.market_value_display,
                  displayCurrency,
                  "summary"
                )
              ) : (
                <span className="text-(--color-text-tertiary) text-2xl">—</span>
              )}
            </div>
          </div>
          <div className="rounded-xl border border-(--color-border-subtle) bg-(--color-bg-panel) px-5 py-4">
            <div className="text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
              Yıllık pasif gelir (ort.)
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-3xl font-semibold tabular tracking-tight text-(--color-accent)">
                {assetStats.market_value_display != null &&
                assetStats.expected_yield_pct != null
                  ? formatCurrency(
                      (assetStats.market_value_display *
                        assetStats.expected_yield_pct) /
                        100,
                      displayCurrency,
                      "summary"
                    )
                  : "—"}
              </span>
              {assetStats.expected_yield_pct != null && (
                <span className="text-sm text-(--color-text-tertiary) tabular">
                  ≈ {assetStats.expected_yield_pct.toFixed(2)}%
                </span>
              )}
            </div>
            {(assetStats.platforms?.length ?? 0) > 1 && (
              <div className="mt-0.5 text-[11px] text-(--color-text-tertiary)">
                {assetStats.platforms.length} platformun cost-basis ağırlıklı
                ortalaması
              </div>
            )}
          </div>
        </div>
      )}

      {/* Fiyat geçmişi grafiği */}
      <PriceChart
        assetId={asset.id}
        assetCurrency={asset.currency}
        avgCost={
          assetStats && assetStats.balance > 0 ? assetStats.avg_cost : null
        }
        transactions={txns}
      />

      {/* Pozisyon kartı */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <PositionStat
          label="Bakiye"
          value={
            assetStats
              ? `${formatNumber(assetStats.balance, "detail")} ${asset.symbol}`
              : "—"
          }
        />
        <PositionStat
          label="Ort. maliyet"
          value={
            assetStats && assetStats.balance > 0
              ? formatCurrency(assetStats.avg_cost, asset.currency, "summary")
              : "—"
          }
        />
        <PositionStat
          label="Toplam değer"
          value={
            assetStats?.market_value_display != null
              ? formatCurrency(assetStats.market_value_display, displayCurrency, "summary")
              : "—"
          }
        />
        <PositionStat
          label="Kar/Zarar"
          value={
            assetStats?.unrealized_pl_display != null
              ? formatChange(assetStats.unrealized_pl_display, displayCurrency, "summary")
              : "—"
          }
          colorClass={
            assetStats?.unrealized_pl_display != null
              ? changeClass(assetStats.unrealized_pl_display)
              : undefined
          }
        />
      </div>

      {/* Platform dağılımı — birden fazla platform varsa göster */}
      {platformBreakdown.length > 1 && (
        <div className="space-y-2">
          <h3 className="text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
            Platform dağılımı
          </h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {platformBreakdown.map(([platform, bal]) => {
              const totalBalance = platformBreakdown.reduce(
                (s, [, v]) => s + v,
                0
              );
              const pct =
                totalBalance > 0 ? (bal / totalBalance) * 100 : 0;
              return (
                <div
                  key={platform}
                  className="rounded-lg border border-(--color-border-subtle) bg-(--color-bg-panel) px-3 py-2"
                >
                  <div className="text-[10px] font-medium tracking-[0.05em] text-(--color-text-tertiary) uppercase">
                    {platform === "—" ? "Atanmamış" : platform}
                  </div>
                  <div className="mt-0.5 text-sm font-semibold tabular">
                    {formatNumber(bal, "detail")} {asset.symbol}
                  </div>
                  <div className="text-[10px] text-(--color-text-tertiary) tabular">
                    %{pct.toFixed(1)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tarihçe */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
            İşlem geçmişi
          </h3>
          <button
            onClick={onAddTx}
            className={`${buttonPrimary} inline-flex items-center gap-1.5`}
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} />
            İşlem Ekle
          </button>
        </div>

        {/* Etiket filtre chip'leri */}
        {tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] tracking-[0.05em] text-(--color-text-tertiary) uppercase mr-1">
              Filtrele:
            </span>
            {tags.map((t) => {
              const active = t === activeTag;
              return (
                <button
                  key={t}
                  onClick={() => setActiveTag(active ? null : t)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs transition-colors",
                    active
                      ? "border-(--color-accent) bg-(--color-accent)/12 text-(--color-accent)"
                      : "border-(--color-border-subtle) text-(--color-text-secondary) hover:border-(--color-border-strong) hover:text-(--color-text-primary)"
                  )}
                >
                  #{t}
                  {active && <X className="h-3 w-3" />}
                </button>
              );
            })}
            {activeTag && (
              <button
                onClick={() => setActiveTag(null)}
                className="text-xs text-(--color-text-tertiary) underline-offset-2 hover:underline"
              >
                temizle
              </button>
            )}
          </div>
        )}

        {txLoading ? (
          <div className="space-y-2 rounded-xl border border-(--color-border-subtle) bg-(--color-bg-panel) p-4">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : visibleTxns.length === 0 ? (
          <div className="rounded-xl border border-(--color-border-subtle) bg-(--color-bg-panel) px-6 py-8 text-center">
            <p className="text-sm text-(--color-text-secondary)">
              {activeTag
                ? `"#${activeTag}" etiketiyle işlem yok.`
                : "Bu varlık için henüz işlem girilmedi."}
            </p>
          </div>
        ) : (
          <div className="relative rounded-xl border border-(--color-border-subtle) bg-(--color-bg-panel)">
            {/* Sütun toggle — sağ üst */}
            <div className="absolute right-2 top-2 z-10" data-tx-cols-menu>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setTxColsOpen((v) => !v);
                }}
                className="rounded-md border border-(--color-border-subtle) bg-(--color-bg-base) p-1 text-(--color-text-tertiary) transition-colors hover:text-(--color-text-primary)"
                title="Sütunları düzenle"
              >
                <Columns3 className="h-3.5 w-3.5" />
              </button>
              {txColsOpen && (
                <div className="absolute right-0 top-full mt-1 min-w-[200px] overflow-hidden rounded-lg border border-(--color-border-subtle) bg-(--color-bg-panel) py-1 text-sm shadow-2xl shadow-black/50">
                  <div className="px-3 pb-1 pt-0.5 text-[10px] tracking-wide text-(--color-text-tertiary) uppercase">
                    Tut & sürükle sıralama
                  </div>
                  {txColOrder.map((k) => (
                    <div
                      key={k}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", k);
                        setTxDragKey(k);
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const dropped = e.dataTransfer.getData("text/plain") as TxColKey;
                        if (dropped && dropped !== k) reorderTxCols(dropped, k);
                        setTxDragKey(null);
                      }}
                      onDragEnd={() => setTxDragKey(null)}
                      className={cn(
                        "flex select-none items-center gap-2 px-2 py-1.5 transition-colors",
                        txDragKey === k
                          ? "bg-(--color-accent)/10"
                          : "hover:bg-(--color-bg-hover)"
                      )}
                    >
                      <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-(--color-text-tertiary)" />
                      <label className="flex flex-1 cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={txCols[k]}
                          onChange={() => toggleTxCol(k)}
                          className="h-3.5 w-3.5 accent-(--color-accent)"
                        />
                        <span className="text-(--color-text-primary)">
                          {TX_COL_LABELS[k]}
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
                  <Th>Tarih</Th>
                  {txColOrder.map((k) => {
                    if (!txCols[k]) return null;
                    const align = (k === "qty" || k === "price" || k === "fee" || k === "yield") ? "right" : undefined;
                    return (
                      <Th key={k} align={align}>
                        {TX_COL_LABELS[k]}
                      </Th>
                    );
                  })}
                  <th className="w-20" />
                </tr>
              </thead>
              <tbody>
                {visibleTxns.map((t) => {
                  const typeColor =
                    t.type === "buy"
                      ? "text-(--color-success)"
                      : t.type === "sell"
                      ? "text-(--color-danger)"
                      : "text-(--color-accent)";
                  const typeLabel =
                    t.type === "buy"
                      ? "Alış"
                      : t.type === "sell"
                      ? "Satış"
                      : t.source
                      ? sourceLabel(t.source)
                      : "Pasif Gelir";
                  return (
                    <tr
                      key={t.id}
                      className="border-b border-(--color-border-subtle) last:border-b-0"
                    >
                      <Td className="text-(--color-text-secondary)">
                        {formatDate(t.date)}
                      </Td>
                      {txColOrder.map((k) => {
                        if (!txCols[k]) return null;
                        switch (k) {
                          case "type":
                            return (
                              <Td key={k}>
                                <span className={`text-xs font-medium ${typeColor}`}>
                                  {typeLabel}
                                </span>
                              </Td>
                            );
                          case "qty":
                            return (
                              <Td key={k} align="right" className="tabular">
                                {formatNumber(t.quantity, "detail")}
                              </Td>
                            );
                          case "price":
                            return (
                              <Td key={k} align="right" className="tabular">
                                {t.price > 0
                                  ? formatCurrency(t.price, asset.currency, "detail")
                                  : "—"}
                              </Td>
                            );
                          case "fee":
                            return (
                              <Td key={k} align="right" className="tabular text-(--color-text-tertiary)">
                                {t.fee > 0 ? formatCurrency(t.fee, asset.currency, "detail") : "—"}
                              </Td>
                            );
                          case "platform":
                            return (
                              <Td key={k}>
                                {t.platform ? (
                                  <span className="rounded bg-(--color-bg-base) px-1.5 py-0.5 text-[11px] font-medium tracking-wide text-(--color-text-secondary)">
                                    {t.platform}
                                  </span>
                                ) : (
                                  <span className="text-xs text-(--color-text-tertiary)">—</span>
                                )}
                              </Td>
                            );
                          case "yield":
                            return (
                              <Td key={k} align="right" className="tabular text-(--color-text-tertiary)">
                                {t.expected_yield_pct != null
                                  ? `${t.expected_yield_pct.toFixed(2)}%`
                                  : "—"}
                              </Td>
                            );
                          case "note":
                            return (
                              <Td key={k} className="text-(--color-text-secondary)">
                                {t.note ?? <span className="text-(--color-text-tertiary)">—</span>}
                              </Td>
                            );
                        }
                      })}
                      <Td>
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() =>
                              openModal(<EditTransactionModal asset={asset} tx={t} />)
                            }
                            aria-label="Düzenle"
                            className="text-(--color-text-tertiary) transition-colors hover:text-(--color-text-primary)"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => onDeleteTx(t.id)}
                            aria-label="Sil"
                            className="text-(--color-text-tertiary) transition-colors hover:text-(--color-danger)"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function sourceLabel(s: string): string {
  if (s === "staking") return "Staking";
  if (s === "dividend") return "Temettü";
  if (s === "interest") return "Faiz";
  return s;
}

function PositionStat({
  label,
  value,
  colorClass,
}: {
  label: string;
  value: string;
  colorClass?: string;
}) {
  return (
    <div className="rounded-xl border border-(--color-border-subtle) bg-(--color-bg-panel) px-4 py-3">
      <div className="text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
        {label}
      </div>
      <div
        className={`mt-1 text-base font-semibold tabular ${
          colorClass ?? ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function Th({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: "right";
}) {
  return (
    <th
      className={[
        "px-4 py-2.5 text-[11px] font-medium tracking-[0.05em] uppercase",
        align === "right" ? "text-right" : "text-left",
      ].join(" ")}
    >
      {children}
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
