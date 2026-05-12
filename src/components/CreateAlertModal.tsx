import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ModalShell,
  Field,
  inputClass,
  buttonGhost,
  buttonPrimary,
} from "./Modal";
import { api, type Asset, type PriceAlert } from "../lib/api";
import { useUIStore } from "../stores/uiStore";
import { usePortfolioStore } from "../stores/portfolioStore";
import { useAssetStore } from "../stores/assetStore";
import { playSound } from "../lib/sounds";
import { cn } from "../lib/cn";

type Condition = "above" | "below";

export function CreateAlertModal({
  onCreated,
  presetAssetId,
  existing,
}: {
  onCreated: () => void;
  presetAssetId?: number;
  existing?: PriceAlert;
}) {
  const closeModal = useUIStore((s) => s.closeModal);
  const portfolios = usePortfolioStore((s) => s.portfolios);
  const assetsByPortfolio = useAssetStore((s) => s.byPortfolio);
  const refreshAssets = useAssetStore((s) => s.refresh);

  const [assetId, setAssetId] = useState<number | null>(
    existing?.asset_id ?? presetAssetId ?? null
  );
  const [condition, setCondition] = useState<Condition>(
    (existing?.condition as Condition) ?? "above"
  );
  const [threshold, setThreshold] = useState(
    existing ? existing.threshold.toString() : ""
  );
  const [submitting, setSubmitting] = useState(false);
  const isEdit = !!existing;

  // Tüm portföylerin asset'lerini çek
  useEffect(() => {
    portfolios.forEach((p) => refreshAssets(p.id).catch(() => {}));
  }, [portfolios, refreshAssets]);

  const allAssets: Asset[] = portfolios.flatMap(
    (p) => assetsByPortfolio[p.id] ?? []
  );

  const selectedAsset = allAssets.find((a) => a.id === assetId) ?? null;

  const onSubmit = async () => {
    if (!selectedAsset) {
      playSound("error");
      toast.error("Önce bir varlık seç");
      return;
    }
    const t = parseFloat(threshold.replace(",", "."));
    if (!Number.isFinite(t) || t <= 0) {
      playSound("error");
      toast.error("Eşik 0'dan büyük olmalı");
      return;
    }
    setSubmitting(true);
    try {
      if (isEdit && existing) {
        await api.updateAlert({
          id: existing.id,
          condition,
          threshold: t,
          currency: selectedAsset.currency,
          active: true,
        });
        playSound("ding");
        toast.success("Alarm güncellendi");
      } else {
        await api.createAlert({
          assetId: selectedAsset.id,
          condition,
          threshold: t,
          currency: selectedAsset.currency,
        });
        playSound("ding");
        toast.success("Alarm hazır", {
          description: "Fiyat eşiği geçince haber alacaksın.",
        });
      }
      onCreated();
      closeModal();
    } catch (err) {
      playSound("error");
      toast.error(isEdit ? "Güncellenemedi" : "Alarm oluşturulamadı", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell
      title={isEdit ? "Alarmı düzenle" : "Yeni alarm"}
      description={
        isEdit
          ? "Eşiği veya koşulu değiştir."
          : "Bir varlığa eşik koy, fiyat oraya gelince haber verelim."
      }
    >
      <Field label="Varlık">
        <select
          value={assetId ?? ""}
          onChange={(e) =>
            setAssetId(e.target.value ? parseInt(e.target.value, 10) : null)
          }
          disabled={isEdit}
          className={cn(inputClass, isEdit && "opacity-60 cursor-not-allowed")}
        >
          <option value="">— seç —</option>
          {allAssets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.symbol} • {a.name} ({a.currency})
            </option>
          ))}
        </select>
        {allAssets.length === 0 && !isEdit && (
          <p className="mt-1 text-xs text-(--color-text-tertiary)">
            Önce dashboard'dan bir varlık ekle.
          </p>
        )}
      </Field>

      <div className="mt-4">
        <Field label="Koşul">
          <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-(--color-border-subtle) bg-(--color-bg-base) p-1">
            <button
              onClick={() => setCondition("above")}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-all",
                condition === "above"
                  ? "bg-(--color-success)/15 text-(--color-success)"
                  : "text-(--color-text-secondary) hover:text-(--color-text-primary)"
              )}
            >
              ▲ Üzerine çıkarsa
            </button>
            <button
              onClick={() => setCondition("below")}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-all",
                condition === "below"
                  ? "bg-(--color-danger)/15 text-(--color-danger)"
                  : "text-(--color-text-secondary) hover:text-(--color-text-primary)"
              )}
            >
              ▼ Altına düşerse
            </button>
          </div>
        </Field>
      </div>

      <div className="mt-4">
        <Field
          label={`Eşik (${selectedAsset?.currency ?? "—"})`}
          hint="Fiyat bu değere ulaşırsa OS bildirimi alacaksın."
        >
          <input
            inputMode="decimal"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            className={inputClass}
            placeholder="örn: 100000"
          />
        </Field>
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
          {isEdit ? "Kaydet" : "Alarm kur"}
        </button>
      </div>
    </ModalShell>
  );
}
