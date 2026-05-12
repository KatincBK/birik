import { useMemo, useState } from "react";
import { ChevronRight, Building2 } from "lucide-react";
import { toast } from "sonner";
import {
  ModalShell,
  Field,
  inputClass,
  buttonGhost,
  buttonPrimary,
  buttonSecondary,
} from "./Modal";
import { api, type Asset } from "../lib/api";
import { useAssetStore } from "../stores/assetStore";
import { usePortfolioStore } from "../stores/portfolioStore";
import { useUIStore } from "../stores/uiStore";
import { AssetIcon } from "./AssetIcon";
import { playSound } from "../lib/sounds";
import { cn } from "../lib/cn";

/**
 * 2 adımlı sihirbaz:
 *   1) Platform adı gir (örn "Binance")
 *   2) Bu platforma atamak istediğin varlıkları seç
 * Onaylayınca her seçili varlık için update_asset_platform.
 */
export function BulkPlatformAssignModal({
  initialPlatform,
}: {
  initialPlatform?: string;
}) {
  const closeModal = useUIStore((s) => s.closeModal);
  const portfolios = usePortfolioStore((s) => s.portfolios);
  const byPortfolio = useAssetStore((s) => s.byPortfolio);
  const refreshAssets = useAssetStore((s) => s.refresh);

  const allAssets: Asset[] = useMemo(
    () => portfolios.flatMap((p) => byPortfolio[p.id] ?? []),
    [portfolios, byPortfolio]
  );

  const [step, setStep] = useState<"name" | "pick">("name");
  const [platform, setPlatform] = useState(initialPlatform ?? "");
  const [selected, setSelected] = useState<Set<number>>(() => {
    // Bu platforma zaten atanmış olanları default işaretle
    if (!initialPlatform) return new Set();
    return new Set(
      allAssets.filter((a) => a.platform === initialPlatform).map((a) => a.id)
    );
  });
  const [submitting, setSubmitting] = useState(false);

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(allAssets.map((a) => a.id)));
  const clearAll = () => setSelected(new Set());

  const onPlatformNext = () => {
    if (platform.trim() === "") {
      toast.error("Platform adı boş olamaz");
      playSound("error");
      return;
    }
    setStep("pick");
  };

  const onSubmit = async () => {
    if (selected.size === 0) {
      toast.error("En az bir varlık seç");
      playSound("error");
      return;
    }
    setSubmitting(true);
    const platformName = platform.trim();
    let saved = 0;
    let failed = 0;
    const affectedPortfolios = new Set<number>();
    for (const id of selected) {
      try {
        await api.updateAssetPlatform(id, platformName);
        const a = allAssets.find((x) => x.id === id);
        if (a) affectedPortfolios.add(a.portfolio_id);
        saved += 1;
      } catch (err) {
        failed += 1;
        console.error("[birik] platform assign fail", id, err);
      }
    }
    // Etkilenen portföyleri refresh
    for (const pid of affectedPortfolios) {
      await refreshAssets(pid).catch(() => {});
    }
    setSubmitting(false);
    if (failed > 0) {
      playSound("error");
      toast.error(`${failed} varlık güncellenemedi`, {
        description: `${saved} başarılı`,
      });
    } else {
      playSound("ding");
      toast.success(`${saved} varlık "${platformName}" platformuna atandı`);
      closeModal();
    }
  };

  /* ---------- Step 1: platform adı ---------- */
  if (step === "name") {
    return (
      <ModalShell
        title="Platform ata"
        description="Birden fazla varlığa tek seferde platform ekle"
        footer={
          <>
            <button onClick={closeModal} className={buttonGhost}>
              İptal
            </button>
            <button
              onClick={onPlatformNext}
              className={`${buttonPrimary} inline-flex items-center gap-1`}
            >
              Devam
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </>
        }
      >
        <Field
          label="Platform / borsa"
          hint="Aynı isimde mevcut varlıklar otomatik seçili gelecek"
        >
          <input
            autoFocus
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onPlatformNext();
            }}
            placeholder="örn: Binance, Kraken, İş Bankası"
            className={inputClass}
          />
        </Field>
      </ModalShell>
    );
  }

  /* ---------- Step 2: varlıkları seç ---------- */
  return (
    <ModalShell
      title={`"${platform.trim()}" varlıkları`}
      description="Bu platformda olan varlıkları işaretle"
      footer={
        <>
          <button
            onClick={() => setStep("name")}
            className={buttonSecondary}
            disabled={submitting}
          >
            Geri
          </button>
          <div className="flex-1" />
          <button onClick={closeModal} className={buttonGhost} disabled={submitting}>
            İptal
          </button>
          <button
            onClick={onSubmit}
            disabled={submitting || selected.size === 0}
            className={`${buttonPrimary} inline-flex items-center gap-1.5`}
          >
            <Building2 className="h-3.5 w-3.5" />
            {submitting ? "Kaydediliyor…" : `${selected.size} varlığa ata`}
          </button>
        </>
      }
    >
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="text-(--color-text-tertiary)">
          {selected.size} / {allAssets.length} seçili
        </span>
        <div className="flex gap-1">
          <button
            onClick={selectAll}
            className="rounded px-2 py-1 text-(--color-text-secondary) transition-colors hover:bg-(--color-bg-hover) hover:text-(--color-text-primary)"
          >
            Tümünü seç
          </button>
          <button
            onClick={clearAll}
            className="rounded px-2 py-1 text-(--color-text-secondary) transition-colors hover:bg-(--color-bg-hover) hover:text-(--color-text-primary)"
          >
            Temizle
          </button>
        </div>
      </div>

      {allAssets.length === 0 ? (
        <p className="rounded-lg border border-dashed border-(--color-border-subtle) px-4 py-8 text-center text-sm text-(--color-text-tertiary)">
          Hiç varlık yok.
        </p>
      ) : (
        <div className="space-y-1">
          {allAssets.map((a) => {
            const sel = selected.has(a.id);
            const currentPlatform = a.platform;
            const matchesExisting =
              currentPlatform != null &&
              currentPlatform === platform.trim();
            return (
              <button
                key={a.id}
                onClick={() => toggle(a.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
                  sel
                    ? "border-(--color-accent)/40 bg-(--color-accent)/10"
                    : "border-(--color-border-subtle) bg-(--color-bg-base) hover:bg-(--color-bg-hover)"
                )}
              >
                <span
                  className={cn(
                    "grid h-4 w-4 shrink-0 place-items-center rounded border",
                    sel
                      ? "border-(--color-accent) bg-(--color-accent)"
                      : "border-(--color-border-strong)"
                  )}
                >
                  {sel && (
                    <span className="block h-1.5 w-1.5 rounded-[1px] bg-(--color-bg-base)" />
                  )}
                </span>
                <AssetIcon
                  symbol={a.symbol}
                  iconUrl={a.icon_url}
                  type={a.type}
                  size={24}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {a.symbol}
                    <span className="ml-2 text-xs text-(--color-text-tertiary)">
                      {a.name}
                    </span>
                  </div>
                  {currentPlatform && (
                    <div
                      className={cn(
                        "text-[11px]",
                        matchesExisting
                          ? "text-(--color-accent)"
                          : "text-(--color-text-tertiary)"
                      )}
                    >
                      mevcut: {currentPlatform}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </ModalShell>
  );
}
