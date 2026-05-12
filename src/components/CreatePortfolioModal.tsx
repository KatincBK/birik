import { useState } from "react";
import { toast } from "sonner";
import {
  ModalShell,
  Field,
  inputClass,
  buttonGhost,
  buttonPrimary,
} from "./Modal";
import { usePortfolioStore } from "../stores/portfolioStore";
import { useProfileStore } from "../stores/profileStore";
import { useUIStore } from "../stores/uiStore";
import { playSound } from "../lib/sounds";

export function CreatePortfolioModal() {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const create = usePortfolioStore((s) => s.create);
  const setActive = usePortfolioStore((s) => s.setActive);
  const activeProfileId = useProfileStore((s) => s.activeId);
  const closeModal = useUIStore((s) => s.closeModal);

  const onSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      playSound("error");
      toast.error("Portföy adı boş olamaz");
      return;
    }
    if (activeProfileId == null) {
      playSound("error");
      toast.error("Aktif profil yok");
      return;
    }
    setSubmitting(true);
    try {
      const p = await create(trimmed, activeProfileId);
      setActive(p.id);
      playSound("ding");
      toast.success(`"${p.name}" oluşturuldu`);
      closeModal();
    } catch (err) {
      playSound("error");
      toast.error("Portföy oluşturulamadı", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell
      title="Yeni portföy"
      description="Örn: Emeklilik, Spekülatif, Çocuğun fonu…"
    >
      <Field label="İsim">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSubmit();
          }}
          className={inputClass}
          placeholder="Portföy adı"
        />
      </Field>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={closeModal} className={buttonGhost}>
          İptal
        </button>
        <button
          onClick={onSubmit}
          disabled={submitting}
          className={buttonPrimary}
        >
          Oluştur
        </button>
      </div>
    </ModalShell>
  );
}
