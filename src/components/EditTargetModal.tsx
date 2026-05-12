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
import { useUIStore } from "../stores/uiStore";
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

/**
 * Anasayfa hedef kartından açılan dar modal — sadece bütçenin
 * target_value ve target_date alanlarını günceller. Diğer bütçe
 * alanlarına dokunmaz.
 */
export function EditTargetModal({ budget }: { budget: Budget }) {
  const closeModal = useUIStore((s) => s.closeModal);
  const update = useBudgetStore((s) => s.update);

  const [target, setTarget] = useState(
    budget.target_value != null ? budget.target_value.toString() : ""
  );
  const [targetDate, setTargetDate] = useState(unixToDateInput(budget.target_date));
  const [targetCurrency, setTargetCurrency] = useState(
    budget.target_currency ?? budget.currency
  );
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    const tgt = target.trim() === "" ? null : parseDecimal(target);
    if (tgt != null && tgt <= 0) {
      playSound("error");
      toast.error("Hedef değer pozitif olmalı");
      return;
    }
    setSubmitting(true);
    try {
      await update({
        id: budget.id,
        name: budget.name,
        monthlyIncome: budget.monthly_income,
        monthlyExpense: budget.monthly_expense,
        currency: budget.currency,
        targetValue: tgt,
        targetDate: dateInputToUnix(targetDate),
        targetCurrency: tgt != null ? targetCurrency.toUpperCase() : null,
      });
      playSound("ding");
      toast.success("Hedef güncellendi");
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
      title="Hedef tutarı"
      description={`${budget.name} bütçesi için hedef`}
    >
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <Field label="Hedef değer">
            <input
              autoFocus
              inputMode="decimal"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="örn: 100000"
              className={inputClass}
            />
          </Field>
        </div>
        <Field label="Para">
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
      </div>
      <div className="mt-3">
        <Field label="Hedef tarih (opsiyonel)">
          <input
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button onClick={closeModal} className={buttonGhost}>
          İptal
        </button>
        <button onClick={onSubmit} disabled={submitting} className={buttonPrimary}>
          Kaydet
        </button>
      </div>
    </ModalShell>
  );
}
