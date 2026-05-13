import { useState } from "react";
import { toast } from "sonner";
import {
  ModalShell,
  Field,
  inputClass,
  buttonGhost,
  buttonPrimary,
} from "./Modal";
import { useBudgetStore } from "../stores/budgetStore";
import { useProfileStore } from "../stores/profileStore";
import { useUIStore } from "../stores/uiStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { playSound } from "../lib/sounds";
import type { Budget } from "../lib/api";

function parseDecimal(raw: string): number {
  const v = parseFloat(raw.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(v) ? v : 0;
}

function dateInputToUnix(s: string): number | null {
  if (!s) return null;
  return Math.floor(new Date(s + "T00:00:00").getTime() / 1000);
}

function unixToDateInput(unix: number | null): string {
  if (unix == null) return "";
  const d = new Date(unix * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function CreateBudgetModal({ existing }: { existing?: Budget } = {}) {
  const closeModal = useUIStore((s) => s.closeModal);
  const create = useBudgetStore((s) => s.create);
  const update = useBudgetStore((s) => s.update);
  const setActive = useBudgetStore((s) => s.setActive);
  const activeProfileId = useProfileStore((s) => s.activeId);
  const goBudget = useUIStore((s) => s.goBudget);
  const defaultCurrency = useSettingsStore((s) => s.displayCurrency);

  const [name, setName] = useState(existing?.name ?? "");
  const [target, setTarget] = useState(
    existing?.target_value != null ? existing.target_value.toString() : ""
  );
  const [targetDate, setTargetDate] = useState(
    unixToDateInput(existing?.target_date ?? null)
  );
  const [targetCurrency, setTargetCurrency] = useState(
    existing?.target_currency ?? existing?.currency ?? defaultCurrency
  );
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      playSound("error");
      toast.error("Bütçe adı boş olamaz");
      return;
    }
    const tgt = target.trim() === "" ? null : parseDecimal(target);
    if (tgt != null && tgt <= 0) {
      playSound("error");
      toast.error("Hedef değer pozitif olmalı");
      return;
    }

    if (!existing && activeProfileId == null) {
      playSound("error");
      toast.error("Aktif profil yok");
      return;
    }
    setSubmitting(true);
    try {
      // monthly_income/expense artık kullanılmıyor (line items'tan derive
      // ediliyor) — 0 olarak yaz, backwards compat için.
      const args = {
        name: trimmed,
        monthlyIncome: 0,
        monthlyExpense: 0,
        currency:
          (existing?.currency ?? defaultCurrency).toString().toUpperCase(),
        targetValue: tgt,
        targetDate: dateInputToUnix(targetDate),
        targetCurrency: tgt != null ? targetCurrency.toUpperCase() : null,
      };
      if (existing) {
        await update({ id: existing.id, ...args });
        playSound("ding");
        toast.success("Bütçe güncellendi");
      } else {
        const b = await create({ ...args, profileId: activeProfileId! });
        setActive(b.id);
        goBudget(b.id);
        playSound("ding");
        toast.success(`"${b.name}" oluşturuldu`);
      }
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
      title={existing ? "Bütçeyi düzenle" : "Yeni bütçe"}
      description={
        existing
          ? "Bütçe ismini ve hedefini güncelle. Aylık gelir/gider satırları sayfada eklenir."
          : "Örn: Genel, Ev, Tatil, Emeklilik fonu… Aylık gelir ve gider satırlarını sayfadan ekleyebilirsin."
      }
    >
      <Field label="İsim">
        <input
          autoFocus={!existing}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
          placeholder="Bütçe adı"
        />
      </Field>

      <div className="mt-5 border-t border-(--color-border-subtle) pt-4">
        <p className="mb-3 text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
          Hedef (opsiyonel)
        </p>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Hedef değer">
            <input
              inputMode="decimal"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="örn: 100000"
              className={inputClass}
            />
          </Field>
          <Field label="Hedef para">
            <select
              value={targetCurrency}
              onChange={(e) => setTargetCurrency(e.target.value)}
              className={inputClass}
            >
              {["USD", "TRY", "EUR", "GBP"].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Hedef tarih">
            <input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <button onClick={closeModal} className={buttonGhost}>
          İptal
        </button>
        <button onClick={onSubmit} disabled={submitting} className={buttonPrimary}>
          {existing ? "Kaydet" : "Oluştur"}
        </button>
      </div>
    </ModalShell>
  );
}
