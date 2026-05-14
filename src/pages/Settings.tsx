import { useEffect, useState } from "react";
import {
  Volume2,
  VolumeX,
  Download,
  Upload,
  Save,
  Sparkles,
  Key,
  Eye,
  EyeOff,
  X,
  Coins,
} from "lucide-react";
import { save, open } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { toast } from "sonner";
import {
  useSettingsStore,
  type Currency,
  type RefreshInterval,
} from "../stores/useSettingsStore";
import { api } from "../lib/api";
import { cn } from "../lib/cn";
import {
  buttonGhost,
  buttonPrimary,
  buttonSecondary,
  inputClass,
} from "../components/Modal";
import { playSound } from "../lib/sounds";
import { DEFAULT_STABLECOINS, DEFAULT_COMMODITY_TOKENS } from "../lib/cashLike";

const ALL_CURRENCIES: Currency[] = ["USD", "TRY", "EUR", "BTC", "ETH"];

export function Settings() {
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const currencyCycle = useSettingsStore((s) => s.currencyCycle);
  const setDisplayCurrency = useSettingsStore((s) => s.setDisplayCurrency);
  const soundEnabled = useSettingsStore((s) => s.soundEnabled);
  const toggleSound = useSettingsStore((s) => s.toggleSound);
  const refreshIntervalMin = useSettingsStore((s) => s.refreshIntervalMin);
  const setRefreshInterval = useSettingsStore((s) => s.setRefreshInterval);
  const budgetFutureMonths = useSettingsStore((s) => s.budgetFutureMonths);
  const setBudgetFutureMonths = useSettingsStore((s) => s.setBudgetFutureMonths);
  const cagrFromTransactions = useSettingsStore((s) => s.cagrFromTransactions);
  const setCagrFromTransactions = useSettingsStore(
    (s) => s.setCagrFromTransactions
  );
  const [budgetFutureMonthsInput, setBudgetFutureMonthsInput] = useState(
    budgetFutureMonths.toString()
  );
  useEffect(() => {
    setBudgetFutureMonthsInput(budgetFutureMonths.toString());
  }, [budgetFutureMonths]);

  const [busy, setBusy] = useState<string | null>(null);

  // Hedef ETA hesabı için büyüme tahmini ayarları
  const [growthMode, setGrowthMode] = useState<
    "auto" | "from_investments" | "custom"
  >("auto");
  const [customGrowthPct, setCustomGrowthPct] = useState("8");
  useEffect(() => {
    api
      .getSetting("growth_estimate_mode")
      .then((v) => {
        if (v === "auto" || v === "from_investments" || v === "custom") {
          setGrowthMode(v);
        }
      })
      .catch(() => {});
    api
      .getSetting("custom_growth_pct_yearly")
      .then((v) => {
        if (v != null && v !== "") setCustomGrowthPct(v);
      })
      .catch(() => {});
  }, []);
  const setMode = async (m: "auto" | "from_investments" | "custom") => {
    setGrowthMode(m);
    await api.setSetting("growth_estimate_mode", m).catch(() => {});
    playSound("click");
  };
  const saveCustomGrowth = async () => {
    const parsed = parseFloat(customGrowthPct.replace(",", "."));
    if (!Number.isFinite(parsed)) {
      toast.error("Geçerli bir yüzde gir");
      playSound("error");
      return;
    }
    await api.setSetting("custom_growth_pct_yearly", parsed.toString());
    playSound("ding");
    toast.success(`Yıllık büyüme tahmini: %${parsed}`);
  };

  // Finnhub API key — DB'de saklanıyor, boot'ta load et
  const [finnhubKey, setFinnhubKey] = useState("");
  const [finnhubKeyVisible, setFinnhubKeyVisible] = useState(false);
  const [finnhubKeyLoaded, setFinnhubKeyLoaded] = useState(false);
  useEffect(() => {
    api.getSetting("finnhub_api_key").then((v) => {
      if (v) setFinnhubKey(v);
      setFinnhubKeyLoaded(true);
    }).catch(() => setFinnhubKeyLoaded(true));
  }, []);
  const saveFinnhubKey = async () => {
    setBusy("finnhub");
    try {
      await api.setSetting("finnhub_api_key", finnhubKey.trim());
      playSound("ding");
      toast.success(
        finnhubKey.trim()
          ? "Finnhub key kaydedildi"
          : "Finnhub key temizlendi (Yahoo'ya düşülecek)"
      );
    } catch (err) {
      playSound("error");
      toast.error("Kaydedilemedi", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(null);
    }
  };

  // Cash-like sembol listesi (kullanıcı override)
  const cashExtraSymbols = useSettingsStore((s) => s.cashExtraSymbols);
  const addCashSymbol = useSettingsStore((s) => s.addCashSymbol);
  const removeCashSymbol = useSettingsStore((s) => s.removeCashSymbol);
  const [newCashSymbol, setNewCashSymbol] = useState("");
  const onAddCash = () => {
    const v = newCashSymbol.trim().toUpperCase();
    if (!v) return;
    if (cashExtraSymbols.includes(v)) {
      toast.error("Bu sembol zaten listede");
      playSound("error");
      return;
    }
    if ((DEFAULT_STABLECOINS as readonly string[]).includes(v)) {
      toast.info("Bu sembol zaten varsayılan stablecoin listesinde");
      playSound("click");
      setNewCashSymbol("");
      return;
    }
    addCashSymbol(v);
    setNewCashSymbol("");
    playSound("ding");
  };

  // Commodity-like sembol listesi (tokenize altın/gümüş için)
  const commodityExtraSymbols = useSettingsStore((s) => s.commodityExtraSymbols);
  const addCommoditySymbol = useSettingsStore((s) => s.addCommoditySymbol);
  const removeCommoditySymbol = useSettingsStore((s) => s.removeCommoditySymbol);
  const [newCommoditySymbol, setNewCommoditySymbol] = useState("");
  const onAddCommodity = () => {
    const v = newCommoditySymbol.trim().toUpperCase();
    if (!v) return;
    if (commodityExtraSymbols.includes(v)) {
      toast.error("Bu sembol zaten listede");
      playSound("error");
      return;
    }
    if ((DEFAULT_COMMODITY_TOKENS as readonly string[]).includes(v)) {
      toast.info("Bu sembol zaten varsayılan listede");
      playSound("click");
      setNewCommoditySymbol("");
      return;
    }
    addCommoditySymbol(v);
    setNewCommoditySymbol("");
    playSound("ding");
  };

  const toggleCurrency = async (c: Currency) => {
    let next = currencyCycle.includes(c)
      ? currencyCycle.filter((x) => x !== c)
      : [...currencyCycle, c];
    if (next.length === 0) {
      // Boş bırakma — en az 1 birim olmalı
      toast.error("En az 1 para birimi seçili olmalı");
      playSound("error");
      return;
    }
    // Aktif currency çıkarıldıysa ilk öğeye geç
    if (!next.includes(displayCurrency)) {
      setDisplayCurrency(next[0]);
    }
    // currency_cycle setting'ini güncelle (manuel — store'da setter yok, doğrudan API)
    useSettingsStore.setState({ currencyCycle: next });
    await api.setSetting("currency_cycle", JSON.stringify(next)).catch(() => {});
    playSound("click");
  };

  const onExport = async () => {
    setBusy("export");
    try {
      const json = await api.exportData();
      const path = await save({
        title: "Birik Yedeği",
        defaultPath: `birik-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) {
        setBusy(null);
        return; // kullanıcı iptal etti
      }
      await writeTextFile(path, json);
      playSound("ding");
      toast.success("Yedek alındı", { description: path });
    } catch (err) {
      playSound("error");
      toast.error("Yedek başarısız", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(null);
    }
  };

  const onTriggerBackup = async () => {
    setBusy("autobackup");
    try {
      const path = await api.triggerBackup();
      playSound("ding");
      toast.success("Otomatik klasöre yedek alındı", { description: path });
    } catch (err) {
      playSound("error");
      toast.error("Yedek başarısız", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(null);
    }
  };

  const onImport = async (mode: "replace" | "merge") => {
    if (
      mode === "replace" &&
      !confirm(
        "Tüm mevcut veriler silinecek ve yedekteki veriler yüklenecek. Önce dışa aktararak yedek almak iyi olur. Devam edeyim mi?"
      )
    ) {
      return;
    }
    setBusy(`import-${mode}`);
    try {
      const path = await open({
        title: "Birik yedeği seç",
        multiple: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path || Array.isArray(path)) {
        setBusy(null);
        return;
      }
      const json = await readTextFile(path);
      const result = await api.importData(json, mode);
      playSound("ding");
      toast.success("İçe aktarma tamam", {
        description: `${result.portfolios_added} portföy, ${result.assets_added} varlık, ${result.transactions_added} işlem, ${result.alerts_added} alarm, ${result.investment_entries_added} yatırım kaydı ${mode === "replace" ? "yüklendi" : "eklendi"}`,
      });
    } catch (err) {
      playSound("error");
      toast.error("İçe aktarma hatası", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Ayarlar</h1>
        <p className="mt-1 text-sm text-(--color-text-secondary)">
          Para birimi döngüsü, ses, yenileme aralığı, yedekleme.
        </p>
      </header>

      <Section title="Para birimi">
        <div>
          <Label>Aktif birim</Label>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {currencyCycle.map((c) => {
              const active = c === displayCurrency;
              return (
                <button
                  key={c}
                  onClick={() => setDisplayCurrency(c)}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                    active
                      ? "border-(--color-accent) bg-(--color-accent)/12 text-(--color-accent)"
                      : "border-(--color-border-subtle) text-(--color-text-secondary) hover:border-(--color-border-strong) hover:text-(--color-text-primary)"
                  )}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-5">
          <Label>Döngüye dahil olanlar (Hero'ya tıkla → cycle)</Label>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {ALL_CURRENCIES.map((c) => {
              const checked = currencyCycle.includes(c);
              return (
                <label
                  key={c}
                  className={cn(
                    "inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                    checked
                      ? "border-(--color-accent)/50 bg-(--color-accent)/8 text-(--color-text-primary)"
                      : "border-(--color-border-subtle) text-(--color-text-secondary) hover:border-(--color-border-strong)"
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleCurrency(c)}
                    className="accent-(--color-accent)"
                  />
                  {c}
                </label>
              );
            })}
          </div>
        </div>
      </Section>

      <Section title="Sembol kategorileri">
        <div>
          <div className="flex items-center gap-1.5">
            <Coins className="h-3.5 w-3.5 text-(--color-text-tertiary)" />
            <span className="text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
              Nakit sembolleri
            </span>
          </div>
          <p className="mt-1 text-xs text-(--color-text-tertiary)">
            Tüm fiat para birimleri (USD, EUR, TRY…) ve yaygın stablecoin'ler
            (USDT, USDC, DAI…) zaten "Nakit" kategorisinde sayılır. Burada kendi
            tokenlarını ekleyebilirsin — varlık dağılım pastasında "Nakit" diliminin
            altına düşer.
          </p>

          {/* Varsayılan liste — info chip'ler, tıklanmaz */}
          <div className="mt-3">
            <div className="text-[10px] tracking-[0.05em] text-(--color-text-tertiary) uppercase mb-1.5">
              Varsayılan
            </div>
            <div className="flex flex-wrap gap-1">
              {DEFAULT_STABLECOINS.map((s) => (
                <span
                  key={s}
                  className="rounded-md border border-(--color-border-subtle) bg-(--color-bg-base) px-2 py-0.5 text-[11px] tabular text-(--color-text-tertiary)"
                  title="Varsayılan stablecoin — kaldırılamaz"
                >
                  {s}
                </span>
              ))}
            </div>
          </div>

          {/* Kullanıcının eklediği extra'lar */}
          <div className="mt-3">
            <div className="text-[10px] tracking-[0.05em] text-(--color-text-tertiary) uppercase mb-1.5">
              Senin eklediklerin
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {cashExtraSymbols.length === 0 && (
                <span className="text-xs text-(--color-text-tertiary)">
                  henüz yok
                </span>
              )}
              {cashExtraSymbols.map((s) => (
                <span
                  key={s}
                  className="inline-flex items-center gap-1 rounded-md bg-(--color-accent)/12 px-2 py-0.5 text-[11px] font-medium tabular text-(--color-accent)"
                >
                  {s}
                  <button
                    onClick={() => {
                      removeCashSymbol(s);
                      playSound("swoosh");
                    }}
                    aria-label={`${s} kaldır`}
                    className="text-(--color-accent)/70 hover:text-(--color-accent)"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <input
                value={newCashSymbol}
                onChange={(e) => setNewCashSymbol(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onAddCash();
                  }
                }}
                placeholder="örn: USDE, GHO"
                className={cn(inputClass, "max-w-[200px] flex-1")}
              />
              <button onClick={onAddCash} className={buttonSecondary}>
                Ekle
              </button>
            </div>
          </div>
        </div>

        {/* Emtia (tokenize altın/gümüş) — paralel yapı */}
        <div className="mt-6 border-t border-(--color-border-subtle) pt-5">
          <div className="flex items-center gap-1.5">
            <Coins className="h-3.5 w-3.5 text-(--color-text-tertiary)" />
            <span className="text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
              Emtia sembolleri (tokenize)
            </span>
          </div>
          <p className="mt-1 text-xs text-(--color-text-tertiary)">
            Fiziki altın/gümüşe bağlı kripto tokenları (PAXG, XAUT…) kripto
            değil "Emtia" kategorisinde gösterilsin. Buradaki liste varsayılana
            eklenir.
          </p>

          <div className="mt-3">
            <div className="text-[10px] tracking-[0.05em] text-(--color-text-tertiary) uppercase mb-1.5">
              Varsayılan
            </div>
            <div className="flex flex-wrap gap-1">
              {DEFAULT_COMMODITY_TOKENS.map((s) => (
                <span
                  key={s}
                  className="rounded-md border border-(--color-border-subtle) bg-(--color-bg-base) px-2 py-0.5 text-[11px] tabular text-(--color-text-tertiary)"
                  title="Varsayılan tokenize emtia — kaldırılamaz"
                >
                  {s}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-3">
            <div className="text-[10px] tracking-[0.05em] text-(--color-text-tertiary) uppercase mb-1.5">
              Senin eklediklerin
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {commodityExtraSymbols.length === 0 && (
                <span className="text-xs text-(--color-text-tertiary)">
                  henüz yok
                </span>
              )}
              {commodityExtraSymbols.map((s) => (
                <span
                  key={s}
                  className="inline-flex items-center gap-1 rounded-md bg-(--color-accent)/12 px-2 py-0.5 text-[11px] font-medium tabular text-(--color-accent)"
                >
                  {s}
                  <button
                    onClick={() => {
                      removeCommoditySymbol(s);
                      playSound("swoosh");
                    }}
                    aria-label={`${s} kaldır`}
                    className="text-(--color-accent)/70 hover:text-(--color-accent)"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <input
                value={newCommoditySymbol}
                onChange={(e) => setNewCommoditySymbol(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onAddCommodity();
                  }
                }}
                placeholder="örn: GOLD, METAL"
                className={cn(inputClass, "max-w-[200px] flex-1")}
              />
              <button onClick={onAddCommodity} className={buttonSecondary}>
                Ekle
              </button>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Ses & yenileme">
        <Row
          label="Sesler"
          hint="Tüm bildirim sesleri. Boot'ta DB'den yüklenir."
          right={
            <button
              onClick={() => {
                if (soundEnabled) playSound("click");
                toggleSound();
                if (!soundEnabled) setTimeout(() => playSound("ding"), 0);
              }}
              className={`${buttonSecondary} inline-flex items-center gap-1.5`}
            >
              {soundEnabled ? (
                <>
                  <Volume2 className="h-4 w-4" /> Açık
                </>
              ) : (
                <>
                  <VolumeX className="h-4 w-4" /> Kapalı
                </>
              )}
            </button>
          }
        />
        <Row
          label="Otomatik yenileme aralığı"
          hint="Background loop bu aralıkta cache'i tazeler ve alarmları kontrol eder."
          right={
            <div className="flex gap-1 rounded-lg border border-(--color-border-subtle) bg-(--color-bg-base) p-1">
              {([1, 5, 15] as RefreshInterval[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setRefreshInterval(m)}
                  className={cn(
                    "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                    m === refreshIntervalMin
                      ? "bg-(--color-bg-hover) text-(--color-text-primary)"
                      : "text-(--color-text-secondary) hover:text-(--color-text-primary)"
                  )}
                >
                  {m} dk
                </button>
              ))}
            </div>
          }
        />
      </Section>

      <Section title="Bütçe planlama">
        <Row
          label="İleri görünür ay sayısı"
          hint="Bütçe sayfasında bugünden itibaren kaç ay ileri görünsün. Geçmiş veriler her zaman tam görünür."
          right={
            <div className="flex items-center gap-2">
              <input
                inputMode="numeric"
                value={budgetFutureMonthsInput}
                onChange={(e) =>
                  setBudgetFutureMonthsInput(e.target.value.replace(/[^0-9]/g, ""))
                }
                onBlur={() => {
                  const n = parseInt(budgetFutureMonthsInput, 10);
                  if (Number.isFinite(n)) setBudgetFutureMonths(n);
                  else setBudgetFutureMonthsInput(budgetFutureMonths.toString());
                }}
                className="w-16 rounded-lg border border-(--color-border-subtle) bg-(--color-bg-base) px-2 py-1 text-right text-sm tabular outline-none focus:border-(--color-accent)"
              />
              <span className="text-sm text-(--color-text-tertiary)">ay</span>
            </div>
          }
        />
      </Section>

      <Section title="Hedef büyüme tahmini">
        <Row
          label="Tahmin kaynağı"
          hint="Hedefe kalan süre hesabında kullanılan yıllık sermaye büyüme oranı. Pasif gelir (asset yield) ayrıca eklenir."
          right={
            <div className="flex gap-1 rounded-lg border border-(--color-border-subtle) bg-(--color-bg-base) p-1">
              {(
                [
                  { k: "auto", label: "Otomatik" },
                  { k: "from_investments", label: "Yatırım kayıtları" },
                  { k: "custom", label: "Custom" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.k}
                  onClick={() => setMode(opt.k)}
                  className={cn(
                    "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                    growthMode === opt.k
                      ? "bg-(--color-bg-hover) text-(--color-text-primary)"
                      : "text-(--color-text-secondary) hover:text-(--color-text-primary)"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          }
        />
        {growthMode === "auto" && (
          <p className="text-xs text-(--color-text-tertiary)">
            Portföyün tarihsel CAGR'ı (cost-weighted) varsa kullanılır; yeterli
            veri yoksa <span className="tabular text-(--color-text-secondary)">%8</span> baseline.
          </p>
        )}
        {growthMode === "from_investments" && (
          <p className="text-xs text-(--color-warning)">
            Doğru veri için "Yatırım" sekmesindeki kayıtların her aya ait olduğundan
            emin ol. Eksik kayıt → büyüme oranı yanıltıcı olur.
          </p>
        )}
        {growthMode === "custom" && (
          <Row
            label="Yıllık büyüme (%)"
            hint="Senin beklentin. SP500 ortalaması ≈ %10, BIST 100 ≈ %30 (TL bazlı)."
            right={
              <div className="flex items-center gap-2">
                <input
                  inputMode="decimal"
                  value={customGrowthPct}
                  onChange={(e) => setCustomGrowthPct(e.target.value)}
                  className="w-20 rounded-lg border border-(--color-border-subtle) bg-(--color-bg-base) px-2 py-1 text-right text-sm tabular outline-none focus:border-(--color-accent)"
                />
                <span className="text-sm text-(--color-text-tertiary)">% / yıl</span>
                <button
                  onClick={saveCustomGrowth}
                  className={`${buttonSecondary} inline-flex items-center gap-1.5`}
                >
                  <Save className="h-3.5 w-3.5" />
                  Kaydet
                </button>
              </div>
            }
          />
        )}
        <Row
          label="Yıllık getiri hesabı"
          hint="Anasayfadaki 'Yıllık getiri' kartı — XIRR (para-ağırlıklı, her giriş kendi tarihinden sayılır). Otomatik: yatırım kaydın varsa ondan, yoksa alım-satım işlemlerinden. 'Alım-satım': yatırım kaydı olsa bile hep işlemlerden hesaplar."
          right={
            <div className="flex gap-1 rounded-lg border border-(--color-border-subtle) bg-(--color-bg-base) p-1">
              {(
                [
                  { v: false, label: "Otomatik" },
                  { v: true, label: "Alım-satım" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => setCagrFromTransactions(opt.v)}
                  className={cn(
                    "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                    cagrFromTransactions === opt.v
                      ? "bg-(--color-bg-hover) text-(--color-text-primary)"
                      : "text-(--color-text-secondary) hover:text-(--color-text-primary)"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          }
        />
      </Section>

      <Section title="Veri kaynakları">
        <div>
          <div className="flex items-center gap-1.5">
            <Key className="h-3.5 w-3.5 text-(--color-text-tertiary)" />
            <span className="text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
              Finnhub API key
            </span>
            <span className="text-[11px] text-(--color-text-tertiary)">(opsiyonel)</span>
          </div>
          <p className="mt-1 text-xs text-(--color-text-tertiary)">
            Hisseler için Yahoo yerine Finnhub kullanılır — daha güvenilir,
            temettü oranı + haberler otomatik gelir.{" "}
            <a
              href="https://finnhub.io/register"
              target="_blank"
              rel="noreferrer"
              className="text-(--color-accent) hover:underline"
            >
              Ücretsiz key al
            </a>
            . Boş bırakırsan Yahoo'ya düşer.
          </p>
          <div className="mt-2 flex gap-2">
            <div className="relative flex-1">
              <input
                type={finnhubKeyVisible ? "text" : "password"}
                value={finnhubKey}
                onChange={(e) => setFinnhubKey(e.target.value)}
                placeholder={finnhubKeyLoaded ? "ck_..." : "yükleniyor…"}
                disabled={!finnhubKeyLoaded}
                className="w-full rounded-lg border border-(--color-border-subtle) bg-(--color-bg-base) px-3 py-2 pr-9 text-sm tabular outline-none focus:border-(--color-accent)"
              />
              <button
                type="button"
                onClick={() => setFinnhubKeyVisible((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-(--color-text-tertiary) hover:text-(--color-text-primary)"
                aria-label={finnhubKeyVisible ? "Gizle" : "Göster"}
              >
                {finnhubKeyVisible ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            <button
              onClick={saveFinnhubKey}
              disabled={busy === "finnhub" || !finnhubKeyLoaded}
              className={buttonPrimary}
            >
              Kaydet
            </button>
          </div>
        </div>
      </Section>

      <Section title="Yedekleme">
        <Row
          label="Manuel dışa aktar"
          hint="JSON dosyası kaydedilir. Tüm portföy/varlık/işlem/alarm/hedef dahil."
          right={
            <button
              onClick={onExport}
              disabled={busy === "export"}
              className={`${buttonPrimary} inline-flex items-center gap-1.5`}
            >
              <Download className="h-4 w-4" />
              Dışa aktar
            </button>
          }
        />
        <Row
          label="Otomatik klasöre yaz"
          hint="AppData/com.birik.app/backups/ — günlük 7'lik rotasyon zaten arka planda çalışır."
          right={
            <button
              onClick={onTriggerBackup}
              disabled={busy === "autobackup"}
              className={`${buttonSecondary} inline-flex items-center gap-1.5`}
            >
              <Save className="h-4 w-4" />
              Şimdi yaz
            </button>
          }
        />
        <Row
          label="İçe aktar — birleştir"
          hint="Mevcut verilere ek — eşleşen portföy/varlık/işlem atlanır."
          right={
            <button
              onClick={() => onImport("merge")}
              disabled={busy === "import-merge"}
              className={`${buttonSecondary} inline-flex items-center gap-1.5`}
            >
              <Sparkles className="h-4 w-4" />
              Birleştir
            </button>
          }
        />
        <Row
          label="İçe aktar — değiştir"
          hint="Tüm mevcut verileri siler, yedektekileri yerleştirir. Geri alınamaz."
          right={
            <button
              onClick={() => onImport("replace")}
              disabled={busy === "import-replace"}
              className={`${buttonGhost} inline-flex items-center gap-1.5 text-(--color-danger) hover:text-(--color-danger)`}
            >
              <Upload className="h-4 w-4" />
              Değiştir
            </button>
          }
        />
      </Section>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-(--color-border-subtle) bg-(--color-bg-panel) p-5">
      <h2 className="mb-4 text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
      {children}
    </span>
  );
}

function Row({
  label,
  hint,
  right,
}: {
  label: string;
  hint?: string;
  right: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-(--color-text-primary)">
          {label}
        </div>
        {hint && (
          <div className="mt-0.5 text-xs text-(--color-text-tertiary)">
            {hint}
          </div>
        )}
      </div>
      <div className="shrink-0">{right}</div>
    </div>
  );
}
