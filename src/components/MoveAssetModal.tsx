import { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, History, ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import {
  ModalShell,
  Field,
  inputClass,
  buttonGhost,
  buttonPrimary,
} from "./Modal";
import { Skeleton } from "./Skeleton";
import { AssetIcon } from "./AssetIcon";
import { api, type Asset, type Transaction } from "../lib/api";
import { useUIStore } from "../stores/uiStore";
import { usePortfolioStore } from "../stores/portfolioStore";
import { useAssetStore } from "../stores/assetStore";
import { useStatsStore } from "../stores/statsStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { formatCurrency } from "../lib/format";
import { cn } from "../lib/cn";
import { playSound } from "../lib/sounds";

function parseDecimal(raw: string): number {
  const s = raw.replace(/\s/g, "").replace(",", ".");
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : NaN;
}
function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "";
  if (n === 0) return "0";
  return parseFloat(n.toPrecision(10)).toString();
}

/**
 * İşlemlerden bakiye + ağırlıklı ortalama maliyet — backend
 * `calc::position_from_transactions` ile aynı algoritma (average cost).
 */
function computePosition(txns: Transaction[]): {
  balance: number;
  avgCost: number;
} {
  const sorted = [...txns]
    .filter((t) => t.is_deleted === 0)
    .sort((a, b) => a.date - b.date || a.id - b.id);
  let totalCost = 0;
  let balance = 0;
  for (const t of sorted) {
    if (t.type === "buy") {
      totalCost += t.quantity * t.price + t.fee;
      balance += t.quantity;
    } else if (t.type === "sell") {
      const avg = balance > 0 ? totalCost / balance : 0;
      totalCost -= avg * t.quantity;
      balance -= t.quantity;
      if (Math.abs(balance) < 1e-12) {
        balance = 0;
        totalCost = 0;
      }
    } else if (t.type === "passive_income") {
      balance += t.quantity;
    }
  }
  const avgCost = Math.abs(balance) > 1e-12 ? totalCost / balance : 0;
  return { balance, avgCost };
}

/**
 * Bir varlığı başka bir portföye taşı.
 *  - Ticaret: kaynaktan güncel fiyattan sat, hedefe al — kâr/zarar gerçekleşir.
 *  - Transfer (tam bakiye): tüm işlem kayıtları gerçek tarihleriyle hedefe taşınır.
 *  - Transfer (kısmi): bugün tarihli, ortalama maliyetten çıkış+giriş — kâr/zarar yok.
 */
export function MoveAssetModal({ asset }: { asset: Asset }) {
  const closeModal = useUIStore((s) => s.closeModal);
  const portfolios = usePortfolioStore((s) => s.portfolios);
  const refreshAssets = useAssetStore((s) => s.refresh);
  const recompute = useStatsStore((s) => s.recompute);
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);

  const destOptions = useMemo(
    () => portfolios.filter((p) => p.id !== asset.portfolio_id),
    [portfolios, asset.portfolio_id]
  );

  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState(0);
  const [avgCost, setAvgCost] = useState(0);
  const [marketPrice, setMarketPrice] = useState<number | null>(null);

  const [destPortfolioId, setDestPortfolioId] = useState<number | null>(
    () => destOptions[0]?.id ?? null
  );
  const [quantity, setQuantity] = useState("");
  const [mode, setMode] = useState<"trade" | "transfer">("transfer");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [txns, cached] = await Promise.all([
          api.listTransactions(asset.id, false),
          api.getCachedPrice(asset.id).catch(() => null),
        ]);
        if (cancelled) return;
        const pos = computePosition(txns);
        setBalance(pos.balance);
        setAvgCost(pos.avgCost);
        setMarketPrice(cached?.price ?? null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [asset.id]);

  const qty = parseDecimal(quantity);
  const qtyValid = Number.isFinite(qty) && qty > 0 && qty <= balance + 1e-9;
  const isFull = Number.isFinite(qty) && qty >= balance - 1e-9 && qty > 0;
  const isFullTransfer = mode === "transfer" && isFull;
  const noMarketPrice = marketPrice == null || marketPrice <= 0;

  const onSubmit = async () => {
    if (destPortfolioId == null) {
      toast.error("Hedef portföy seç");
      return;
    }
    if (!qtyValid) {
      playSound("error");
      toast.error(`Miktar 0 ile ${fmtNum(balance)} arasında olmalı`);
      return;
    }
    if (mode === "trade" && noMarketPrice) {
      playSound("error");
      toast.error("Güncel fiyat yok — ticaret modu için fiyat gerekli");
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.moveAssetToPortfolio({
        assetId: asset.id,
        destPortfolioId,
        quantity: qty,
        mode,
        price: mode === "trade" ? marketPrice : null,
      });
      await Promise.all([
        refreshAssets(asset.portfolio_id).catch(() => {}),
        refreshAssets(destPortfolioId).catch(() => {}),
      ]);
      recompute(asset.portfolio_id, displayCurrency).catch(() => {});
      recompute(destPortfolioId, displayCurrency).catch(() => {});
      playSound("ding");
      const destName =
        destOptions.find((p) => p.id === destPortfolioId)?.name ?? "";
      toast.success(
        res.mode === "transfer"
          ? res.full_transfer
            ? `Tüm ${asset.symbol} kayıtları "${destName}" portföyüne taşındı`
            : `${fmtNum(res.moved_quantity)} ${asset.symbol} "${destName}" portföyüne transfer edildi`
          : `${fmtNum(res.moved_quantity)} ${asset.symbol} "${destName}" portföyüne taşındı`
      );
      closeModal();
    } catch (err) {
      playSound("error");
      toast.error("Taşınamadı", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  };

  /* --- Mod açıklaması --- */
  const modeHint = (() => {
    if (mode === "transfer") {
      if (isFullTransfer) {
        return "Tüm işlem geçmişi (orijinal tarih, fiyat ve platformlarıyla) hedef portföye taşınır. Kaynak portföyden tamamen kalkar, kâr/zarar oluşmaz.";
      }
      return `Bugün tarihli, ortalama maliyetten (≈ ${formatCurrency(
        avgCost,
        asset.currency,
        "summary"
      )}) bir çıkış + giriş çifti oluşur. Maliyet korunur, kâr/zarar oluşmaz.`;
    }
    return noMarketPrice
      ? "Güncel fiyat bulunamadı — önce fiyatı yenile."
      : `Güncel fiyattan (≈ ${formatCurrency(
          marketPrice as number,
          asset.currency,
          "summary"
        )}) satış + alış. Kaynak portföyde kâr/zarar gerçekleşir.`;
  })();

  return (
    <ModalShell
      title="Başka portföye taşı"
      description={`${asset.symbol} • ${asset.name}`}
      footer={
        <>
          <button onClick={closeModal} className={buttonGhost} disabled={submitting}>
            İptal
          </button>
          <button
            onClick={onSubmit}
            disabled={submitting || loading || destOptions.length === 0}
            className={buttonPrimary}
          >
            {submitting ? "Taşınıyor…" : "Taşı"}
          </button>
        </>
      }
    >
      {destOptions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-(--color-border-subtle) bg-(--color-bg-base)/40 px-5 py-8 text-center">
          <p className="text-sm text-(--color-text-secondary)">
            Taşınacak başka portföy yok.
          </p>
          <p className="mt-1 text-xs text-(--color-text-tertiary)">
            Önce sol menüden yeni bir portföy oluştur.
          </p>
        </div>
      ) : loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-20" />
        </div>
      ) : (
        <>
          {/* Kaynak varlık */}
          <div className="mb-4 flex items-center gap-3 rounded-lg border border-(--color-border-subtle) bg-(--color-bg-base) px-3 py-2">
            <AssetIcon
              symbol={asset.symbol}
              iconUrl={asset.icon_url}
              type={asset.type}
              size={28}
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium tabular">{asset.symbol}</div>
              <div className="truncate text-xs text-(--color-text-tertiary)">
                {asset.name}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] tracking-wide text-(--color-text-tertiary) uppercase">
                Mevcut
              </div>
              <div className="tabular text-sm font-medium">
                {fmtNum(balance)}
              </div>
            </div>
          </div>

          {/* Hedef portföy */}
          <Field label="Hedef portföy">
            <select
              value={destPortfolioId ?? ""}
              onChange={(e) => setDestPortfolioId(Number(e.target.value))}
              className={inputClass}
            >
              {destOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>

          {/* Miktar */}
          <div className="mt-3">
            <label className="text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
              Miktar
            </label>
            <div className="relative mt-1.5">
              <input
                autoFocus
                inputMode="decimal"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder={`maks ${fmtNum(balance)}`}
                className={cn(
                  inputClass,
                  "pr-12",
                  quantity.trim() !== "" && !qtyValid && "border-(--color-warning)"
                )}
              />
              <button
                type="button"
                onClick={() => setQuantity(fmtNum(balance))}
                title={`Tümü — ${fmtNum(balance)}`}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded bg-(--color-bg-hover) px-1.5 py-0.5 text-[10px] font-semibold text-(--color-text-secondary) transition-colors hover:bg-(--color-accent)/15 hover:text-(--color-accent)"
              >
                maks
              </button>
            </div>
          </div>

          {/* Mod seçimi */}
          <div className="mt-4 space-y-2">
            <label className="text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
              Nasıl taşınsın?
            </label>
            {(
              [
                {
                  key: "transfer" as const,
                  icon: <History className="h-4 w-4" />,
                  title: "Kayıtlarla transfer et",
                  desc: "Maliyet ve geçmiş korunur, kâr/zarar oluşmaz",
                },
                {
                  key: "trade" as const,
                  icon: <ShoppingCart className="h-4 w-4" />,
                  title: "Ticaret olarak ekle",
                  desc: "Güncel fiyattan sat + al, kâr/zarar gerçekleşir",
                },
              ]
            ).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setMode(opt.key)}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors",
                  mode === opt.key
                    ? "border-(--color-accent)/50 bg-(--color-accent)/10"
                    : "border-(--color-border-subtle) bg-(--color-bg-base) hover:border-(--color-border-strong)"
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 shrink-0",
                    mode === opt.key
                      ? "text-(--color-accent)"
                      : "text-(--color-text-tertiary)"
                  )}
                >
                  {opt.icon}
                </span>
                <span className="min-w-0">
                  <span
                    className={cn(
                      "block text-sm font-medium",
                      mode === opt.key && "text-(--color-accent)"
                    )}
                  >
                    {opt.title}
                  </span>
                  <span className="block text-xs text-(--color-text-tertiary)">
                    {opt.desc}
                  </span>
                </span>
              </button>
            ))}
          </div>

          {/* Dinamik açıklama */}
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-(--color-border-subtle) bg-(--color-bg-base)/60 px-3 py-2.5 text-xs text-(--color-text-secondary)">
            <ArrowRightLeft className="mt-0.5 h-3.5 w-3.5 shrink-0 text-(--color-text-tertiary)" />
            <span>{modeHint}</span>
          </div>
        </>
      )}
    </ModalShell>
  );
}
