import { useState, useEffect } from "react";
import { usePortfolioStore } from "../stores/portfolioStore";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { ChevronDown, X, Info } from "lucide-react";
import {
  ModalShell,
  Field,
  inputClass,
  buttonGhost,
  buttonPrimary,
} from "./Modal";
import { api, type Asset, type Transaction } from "../lib/api";
import { useTransactionStore } from "../stores/transactionStore";
import { useAssetStore } from "../stores/assetStore";
import { useUIStore } from "../stores/uiStore";
import { useStatsStore } from "../stores/statsStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { cn } from "../lib/cn";
import { playSound } from "../lib/sounds";

function unixToDateInput(unix: number): string {
  const d = new Date(unix * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dateInputToUnix(s: string): number {
  return Math.floor(new Date(s + "T00:00:00").getTime() / 1000);
}
function todayLocalDateInput(): string {
  return unixToDateInput(Math.floor(Date.now() / 1000));
}
function parseDecimal(raw: string): number {
  const s = raw.replace(/\s/g, "").replace(",", ".");
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : NaN;
}

/**
 * İşlemi düzenle. Tip ve asset değişmez (silip yeniden eklenmesi daha temiz
 * o senaryolarda — bu modal sadece miktar/fiyat/tarih/fee/not/etiket günceller).
 */
export function EditTransactionModal({
  asset,
  tx,
}: {
  asset: Asset;
  tx: Transaction;
}) {
  const [quantity, setQuantity] = useState(tx.quantity.toString());
  const [price, setPrice] = useState(tx.price.toString());
  const [yieldPct, setYieldPct] = useState(
    asset.expected_yield_pct != null ? asset.expected_yield_pct.toString() : ""
  );

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [date, setDate] = useState(unixToDateInput(tx.date));
  const [fee, setFee] = useState(tx.fee > 0 ? tx.fee.toString() : "");
  const [note, setNote] = useState(tx.note ?? "");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [platform, setPlatform] = useState(tx.platform ?? "");
  const [platformFocused, setPlatformFocused] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);

  const closeModal = useUIStore((s) => s.closeModal);
  const refreshTxns = useTransactionStore((s) => s.refresh);
  const refreshAssets = useAssetStore((s) => s.refresh);
  const byPortfolio = useAssetStore((s) => s.byPortfolio);
  const portfolios = usePortfolioStore((s) => s.portfolios);
  const recompute = useStatsStore((s) => s.recompute);
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);

  const knownPlatforms = (() => {
    const set = new Set<string>();
    for (const p of portfolios) {
      for (const a of byPortfolio[p.id] ?? []) {
        if (a.platform && a.platform.trim()) set.add(a.platform.trim());
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  })();

  // Mevcut etiketleri yükle
  useEffect(() => {
    api
      .listTagsOfTransaction(tx.id)
      .then((t) => setTags(t))
      .catch(() => {});
  }, [tx.id]);

  const triggerShake = () => {
    playSound("error");
    setShakeKey((k) => k + 1);
  };

  const addTag = () => {
    const t = tagInput.trim().replace(/^#/, "");
    if (!t) return;
    if (!tags.includes(t)) setTags([...tags, t]);
    setTagInput("");
  };
  const removeTag = (t: string) => setTags(tags.filter((x) => x !== t));

  const onSubmit = async () => {
    const qty = parseDecimal(quantity);
    const prc = parseDecimal(price);
    const f = fee.trim() === "" ? 0 : parseDecimal(fee);

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

    setSubmitting(true);
    try {
      await api.updateTransaction({
        id: tx.id,
        date: dateInputToUnix(date),
        quantity: qty,
        price: prc,
        fee: f,
        note: note.trim() || null,
        tags,
        platform: platform.trim() || null,
      });
      // Yield değiştiyse asset'e yaz
      const currentYield = asset.expected_yield_pct ?? null;
      const yieldChanged =
        (yieldVal === null && currentYield !== null) ||
        (yieldVal !== null && (currentYield === null || Math.abs(yieldVal - currentYield) > 1e-9));
      if (yieldChanged) {
        await api.updateAssetYield(asset.id, yieldVal).catch(() => {});
        refreshAssets(asset.portfolio_id).catch(() => {});
      }

      await refreshTxns(asset.id);
      recompute(asset.portfolio_id, displayCurrency).catch(() => {});
      playSound("ding");
      toast.success("İşlem güncellendi");
      closeModal();
    } catch (err) {
      playSound("error");
      toast.error("Güncelleme başarısız", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell
      title={`${asset.symbol} — işlemi düzenle`}
      description={
        tx.type === "buy"
          ? "Alış"
          : tx.type === "sell"
          ? "Satış"
          : "Pasif gelir (eski kayıt)"
      }
    >
      <div key={shakeKey} className={shakeKey > 0 ? "animate-shake" : ""}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Miktar">
            <input
              autoFocus
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label={`Fiyat (${asset.currency})`}>
            <input
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>

        <div className="mt-4">
          <div className="mb-2 text-[10px] font-medium tracking-[0.06em] text-(--color-text-tertiary) uppercase">
            Opsiyonel
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex h-4 items-center gap-1.5">
                <span className="text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
                  Platform
                </span>
              </div>
              <input
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                onFocus={() => setPlatformFocused(true)}
                onBlur={() => setPlatformFocused(false)}
                placeholder="örn: Binance"
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
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {knownPlatforms.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => setPlatform(p)}
                          className={cn(
                            "rounded-md border px-2 py-0.5 text-[11px] transition-colors",
                            platform === p
                              ? "border-(--color-accent)/40 bg-(--color-accent)/15 text-(--color-accent)"
                              : "border-(--color-border-subtle) bg-(--color-bg-base) text-(--color-text-secondary) hover:border-(--color-accent)/40 hover:text-(--color-accent)"
                          )}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <div>
              <div className="flex h-4 items-center gap-1.5">
                <span className="text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
                  Yıllık getiri
                </span>
                <span className="group relative inline-flex" tabIndex={0}>
                  <Info className="h-3 w-3 text-(--color-text-tertiary) hover:text-(--color-text-secondary) cursor-help" />
                  <span className="pointer-events-none absolute left-1/2 top-full z-10 mt-1 w-60 -translate-x-1/2 rounded-md border border-(--color-border-subtle) bg-(--color-bg-panel) px-2.5 py-1.5 text-xs text-(--color-text-secondary) opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus:opacity-100">
                    Bu varlık için yıllık beklenen staking/faiz/temettü oranı.
                    Asset düzeyinde tutulur — bu değer tüm işlemler için aynıdır.
                  </span>
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  inputMode="decimal"
                  value={yieldPct}
                  onChange={(e) => setYieldPct(e.target.value)}
                  placeholder="örn: 5"
                  className={cn(inputClass, "flex-1")}
                />
                <span className="text-sm text-(--color-text-tertiary)">% / yıl</span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="flex w-full items-center justify-between py-2 text-sm text-(--color-text-secondary) transition-colors hover:text-(--color-text-primary)"
          >
            <span>Gelişmiş</span>
            <motion.span animate={{ rotate: advancedOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
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
                <div className="space-y-3 pt-1">
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
                    <Field label={`Ücret (${asset.currency})`}>
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
                  <Field label="Etiketler">
                    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-(--color-border-subtle) bg-(--color-bg-panel) px-2 py-1.5">
                      {tags.map((t) => (
                        <span
                          key={t}
                          className="inline-flex items-center gap-1 rounded-md bg-(--color-bg-hover) px-2 py-0.5 text-xs text-(--color-text-primary)"
                        >
                          #{t}
                          <button
                            onClick={() => removeTag(t)}
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
                            addTag();
                          }
                        }}
                        onBlur={addTag}
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

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={closeModal} className={buttonGhost}>
            İptal
          </button>
          <button onClick={onSubmit} disabled={submitting} className={buttonPrimary}>
            Kaydet
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
