import { useState } from "react";
import { toast } from "sonner";
import {
  ModalShell,
  Field,
  inputClass,
  buttonGhost,
  buttonPrimary,
} from "./Modal";
import { api, type Asset } from "../lib/api";
import { useAssetStore } from "../stores/assetStore";
import { useUIStore } from "../stores/uiStore";
import { playSound } from "../lib/sounds";

export function EditAssetPlatformModal({ asset }: { asset: Asset }) {
  const closeModal = useUIStore((s) => s.closeModal);
  const refreshAssets = useAssetStore((s) => s.refresh);
  const [value, setValue] = useState(asset.platform ?? "");
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    const trimmed = value.trim();
    setSubmitting(true);
    try {
      await api.updateAssetPlatform(asset.id, trimmed === "" ? null : trimmed);
      await refreshAssets(asset.portfolio_id);
      playSound("ding");
      toast.success(
        trimmed === "" ? "Platform silindi" : `Platform: ${trimmed}`
      );
      closeModal();
    } catch (err) {
      playSound("error");
      toast.error("Kaydedilemedi", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell
      title="Platform / borsa"
      description={`${asset.symbol} hangi platformda?`}
      footer={
        <>
          <button onClick={closeModal} className={buttonGhost} disabled={submitting}>
            İptal
          </button>
          <button onClick={onSubmit} disabled={submitting} className={buttonPrimary}>
            Kaydet
          </button>
        </>
      }
    >
      <Field
        label="Platform"
        hint="Boş bırakırsan kayıt silinir"
      >
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !submitting) onSubmit();
          }}
          placeholder="örn: Binance, Kraken, İş Bankası"
          className={inputClass}
        />
      </Field>
    </ModalShell>
  );
}
