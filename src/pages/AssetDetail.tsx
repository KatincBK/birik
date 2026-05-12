import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Plus, Trash2, X, Pencil, Bell } from "lucide-react";
import { toast } from "sonner";
import { useAssetStore } from "../stores/assetStore";
import { useTransactionStore } from "../stores/transactionStore";
import { useStatsStore } from "../stores/statsStore";
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

  const filteredTxns = activeTag
    ? txns // Etiket filtre backend'de — frontend'de listeyi yeniden çekmek yerine
    : txns;
  // Backend tag filtre uygulamak için ayrı fetch — basitlik için frontend filter:
  // Asset'in tag bilgisi list_transactions'tan gelmiyor (transaction_tags ayrı tablo).
  // Pratik çözüm: tag tıklayınca direkt api çağrısı + lokal state. Aşağıdaki effect.
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
  const visibleTxns = activeTag ? (taggedTxns ?? []) : filteredTxns;

  const stats = useStatsStore((s) =>
    asset ? s.byPortfolio[asset.portfolio_id] ?? null : null
  );
  const recompute = useStatsStore((s) => s.recompute);
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);

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
          <div className="overflow-hidden rounded-xl border border-(--color-border-subtle) bg-(--color-bg-panel)">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-(--color-border-subtle) bg-(--color-bg-base)/40 text-(--color-text-tertiary)">
                  <Th>Tarih</Th>
                  <Th>Tip</Th>
                  <Th align="right">Miktar</Th>
                  <Th align="right">Birim Fiyat</Th>
                  <Th align="right">Ücret</Th>
                  <Th>Not</Th>
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
                      <Td>
                        <span className={`text-xs font-medium ${typeColor}`}>
                          {typeLabel}
                        </span>
                      </Td>
                      <Td align="right" className="tabular">
                        {formatNumber(t.quantity, "detail")}
                      </Td>
                      <Td align="right" className="tabular">
                        {t.price > 0
                          ? formatCurrency(t.price, asset.currency, "detail")
                          : "—"}
                      </Td>
                      <Td align="right" className="tabular text-(--color-text-tertiary)">
                        {t.fee > 0 ? formatCurrency(t.fee, asset.currency, "detail") : "—"}
                      </Td>
                      <Td className="text-(--color-text-secondary)">
                        {t.note ?? <span className="text-(--color-text-tertiary)">—</span>}
                      </Td>
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
