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
} from "../components/Modal";
import { playSound } from "../lib/sounds";

const ALL_CURRENCIES: Currency[] = ["USD", "TRY", "EUR", "BTC", "ETH"];

export function Settings() {
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const currencyCycle = useSettingsStore((s) => s.currencyCycle);
  const setDisplayCurrency = useSettingsStore((s) => s.setDisplayCurrency);
  const soundEnabled = useSettingsStore((s) => s.soundEnabled);
  const toggleSound = useSettingsStore((s) => s.toggleSound);
  const refreshIntervalMin = useSettingsStore((s) => s.refreshIntervalMin);
  const setRefreshInterval = useSettingsStore((s) => s.setRefreshInterval);

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
        description: `${result.portfolios_added} portföy, ${result.assets_added} varlık, ${result.transactions_added} işlem, ${result.alerts_added} alarm, ${result.goals_added} hedef ${mode === "replace" ? "yüklendi" : "eklendi"}`,
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
