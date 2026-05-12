import { useState, useEffect } from "react";
import { usePortfolioStore } from "../stores/portfolioStore";

const LAST_PLATFORM_KEY = "birik.lastPlatform";
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
import { SaleValidationModal } from "./SaleValidationModal";
import { api, type Asset, type Transaction } from "../lib/api";
import { useTransactionStore } from "../stores/transactionStore";
import { useAssetStore } from "../stores/assetStore";
import { useUIStore } from "../stores/uiStore";
import { useStatsStore } from "../stores/statsStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { cn } from "../lib/cn";
import { playSound } from "../lib/sounds";
import { celebrateSmall } from "../lib/celebrate";

type TxType = "buy" | "sell";

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

export function AddTransactionModal({ asset }: { asset: Asset }) {
  const [type, setType] = useState<TxType>("buy");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [yieldPct, setYieldPct] = useState(
    asset.expected_yield_pct != null ? asset.expected_yield_pct.toString() : ""
  );

  // Advanced
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [date, setDate] = useState(todayLocalDateInput());
  const [fee, setFee] = useState("");
  const [note, setNote] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [platform, setPlatform] = useState<string>(
    () => asset.platform ?? localStorage.getItem(LAST_PLATFORM_KEY) ?? ""
  );
  const [platformFocused, setPlatformFocused] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);

  const closeModal = useUIStore((s) => s.closeModal);
  const openModal = useUIStore((s) => s.openModal);
  const create = useTransactionStore((s) => s.create);
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

  // İlk açılışta cache fiyatını fiyat alanına default olarak koy
  useEffect(() => {
    if (price !== "") return;
    let cancelled = false;
    api.getCachedPrice(asset.id).then((p) => {
      if (!cancelled && p) setPrice(p.price.toString());
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [asset.id, price]);

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

  const submitTransaction = async (
    args: Parameters<typeof create>[0]
  ) => {
    setSubmitting(true);
    try {
      // İşlem yarat
      await create(args);

      // Yield güncellemesi (kullanıcı değiştirdiyse)
      const yieldVal = yieldPct.trim() === "" ? null : parseDecimal(yieldPct);
      const currentYield = asset.expected_yield_pct ?? null;
      const yieldChanged =
        (yieldVal === null && currentYield !== null) ||
        (yieldVal !== null && (currentYield === null || Math.abs(yieldVal - currentYield) > 1e-9));
      if (yieldChanged) {
        await api
          .updateAssetYield(asset.id, yieldVal)
          .then(() => refreshAssets(asset.portfolio_id))
          .catch(() => {});
      }

      toast.success("İşlem kaydedildi");
      playSound("ding");
      celebrateSmall();
      closeModal();
      recompute(asset.portfolio_id, displayCurrency).catch(() => {});
    } catch (err) {
      playSound("error");
      toast.error("İşlem kaydedilemedi", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  };

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

    const platformClean = platform.trim() || null;
    if (platformClean) {
      try {
        localStorage.setItem(LAST_PLATFORM_KEY, platformClean);
      } catch {}
    }

    const baseArgs = {
      assetId: asset.id,
      date: dateInputToUnix(date),
      type: type as Transaction["type"],
      source: null as Transaction["source"],
      quantity: qty,
      price: prc,
      fee: f,
      note: note.trim() || null,
      tags: tags.length > 0 ? tags : null,
      platform: platformClean,
    };

    // Satış ise validate
    if (type === "sell") {
      try {
        const v = await api.validateSale(asset.id, qty);
        if (!v.is_sufficient) {
          openModal(
            <SaleValidationModal
              validation={v}
              symbol={asset.symbol}
              onChooseAdjusted={async () => {
                await submitTransaction({
                  ...baseArgs,
                  quantity: Math.max(v.current_balance, 0),
                });
              }}
              onChooseShort={async () => {
                await submitTransaction(baseArgs);
              }}
            />
          );
          return;
        }
      } catch (err) {
        toast.error("Satış kontrolü hatası", {
          description: err instanceof Error ? err.message : String(err),
        });
        return;
      }
    }

    await submitTransaction(baseArgs);
  };

  return (
    <ModalShell
      title={`${asset.symbol} — yeni işlem`}
      description={asset.name}
    >
      <div key={shakeKey} className={shakeKey > 0 ? "animate-shake" : ""}>
        {/* Tip — sadece Alış / Satış */}
        <Field label="Tip">
          <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-(--color-border-subtle) bg-(--color-bg-base) p-1">
            {(["buy", "sell"] as TxType[]).map((t) => {
              const active = t === type;
              const label = t === "buy" ? "Alış" : "Satış";
              return (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium transition-all duration-150",
                    active
                      ? t === "buy"
                        ? "bg-(--color-success)/15 text-(--color-success)"
                        : "bg-(--color-danger)/15 text-(--color-danger)"
                      : "text-(--color-text-secondary) hover:text-(--color-text-primary)"
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </Field>

        {/* Zorunlu: miktar + fiyat */}
        <div className="mt-4 grid grid-cols-2 gap-3">
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
          <Field label={`Fiyat (${asset.currency})`}>
            <input
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="örn: 60000"
              className={inputClass}
            />
          </Field>
        </div>

        {/* Opsiyonel: Platform + Yıllık getiri */}
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
                <span
                  className="group relative inline-flex"
                  tabIndex={0}
                >
                  <Info className="h-3 w-3 text-(--color-text-tertiary) hover:text-(--color-text-secondary) cursor-help" />
                  <span className="pointer-events-none absolute left-1/2 top-full z-10 mt-1 w-60 -translate-x-1/2 rounded-md border border-(--color-border-subtle) bg-(--color-bg-panel) px-2.5 py-1.5 text-xs text-(--color-text-secondary) opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus:opacity-100">
                    Yıllık beklenen staking/faiz/temettü oranı (%). Asset düzeyinde.
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

        {/* Advanced collapsible — düz, kutusuz */}
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="flex w-full items-center justify-between py-2 text-sm text-(--color-text-secondary) transition-colors hover:text-(--color-text-primary)"
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
                  <Field label="Etiketler" hint="Enter ile ekle. Örn: #uzun-vade">
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
          <button
            onClick={onSubmit}
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
