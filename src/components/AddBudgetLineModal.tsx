import { useState } from "react";
import { toast } from "sonner";
import {
  ModalShell,
  Field,
  inputClass,
  buttonGhost,
  buttonPrimary,
} from "./Modal";
import { api, type BudgetLine } from "../lib/api";
import { useUIStore } from "../stores/uiStore";
import { playSound } from "../lib/sounds";
import { cn } from "../lib/cn";

type Kind = "income" | "expense";

const COMMON_CURRENCIES = ["TRY", "USD", "EUR", "GBP"];

function thisMonthYM(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function parseAmount(raw: string): number {
  const s = raw.replace(/\s/g, "").replace(",", ".");
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : NaN;
}

/**
 * Bütçe için tek bir gelir / gider satırı ekle veya düzenle.
 * Satır bir [start_ym, end_ym] aralığında her aya katkı yapar.
 * end_ym boş → açık uçlu (sonsuza kadar).
 */
export function AddBudgetLineModal({
  budgetId,
  defaultKind,
  existing,
  onSaved,
}: {
  budgetId: number;
  defaultKind?: Kind;
  existing?: BudgetLine;
  onSaved?: () => void;
}) {
  const closeModal = useUIStore((s) => s.closeModal);
  const isEdit = !!existing;

  const [kind, setKind] = useState<Kind>(
    (existing?.kind as Kind) ?? defaultKind ?? "income"
  );
  const [label, setLabel] = useState(existing?.label ?? "");
  const [amount, setAmount] = useState(
    existing ? existing.amount.toString() : ""
  );
  const [currency, setCurrency] = useState(existing?.currency ?? "TRY");
  const [startYm, setStartYm] = useState(existing?.start_ym ?? thisMonthYM());
  const [openEnded, setOpenEnded] = useState(existing ? existing.end_ym == null : false);
  const [endYm, setEndYm] = useState(
    existing?.end_ym ?? thisMonthYM()
  );
  const [note, setNote] = useState(existing?.note ?? "");
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    const trimmed = label.trim();
    if (!trimmed) {
      playSound("error");
      toast.error("Etiket boş olamaz");
      return;
    }
    const amt = parseAmount(amount);
    if (!Number.isFinite(amt) || amt === 0) {
      playSound("error");
      toast.error("Geçerli bir tutar gir");
      return;
    }
    if (!/^\d{4}-\d{2}$/.test(startYm)) {
      playSound("error");
      toast.error("Başlangıç ayı geçersiz");
      return;
    }
    if (!openEnded && !/^\d{4}-\d{2}$/.test(endYm)) {
      playSound("error");
      toast.error("Bitiş ayı geçersiz");
      return;
    }
    if (!openEnded && endYm < startYm) {
      playSound("error");
      toast.error("Bitiş ayı başlangıçtan önce olamaz");
      return;
    }

    setSubmitting(true);
    try {
      await api.upsertBudgetLine({
        id: existing?.id ?? null,
        budgetId,
        kind,
        label: trimmed,
        amount: Math.abs(amt),
        currency: currency.toUpperCase(),
        startYm,
        endYm: openEnded ? null : endYm,
        note: note.trim() || null,
      });
      playSound("ding");
      toast.success(isEdit ? "Satır güncellendi" : "Satır eklendi");
      onSaved?.();
      closeModal();
    } catch (err) {
      playSound("error");
      toast.error(isEdit ? "Güncellenemedi" : "Eklenemedi", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell
      title={isEdit ? "Satırı düzenle" : "Yeni satır"}
      description={
        kind === "income"
          ? "Bu gelir, belirtilen ay aralığında her aya katkı yapacak."
          : "Bu gider, belirtilen ay aralığında her aya katkı yapacak."
      }
    >
      {/* Tip */}
      <Field label="Tip">
        <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-(--color-border-subtle) bg-(--color-bg-base) p-1">
          {(["income", "expense"] as Kind[]).map((k) => {
            const active = k === kind;
            const label = k === "income" ? "Gelir" : "Gider";
            return (
              <button
                key={k}
                onClick={() => setKind(k)}
                disabled={isEdit}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-all",
                  active
                    ? k === "income"
                      ? "bg-(--color-success)/15 text-(--color-success)"
                      : "bg-(--color-danger)/15 text-(--color-danger)"
                    : "text-(--color-text-secondary) hover:text-(--color-text-primary)",
                  isEdit && "cursor-not-allowed opacity-50"
                )}
                title={isEdit ? "Düzenlerken tip değiştirilemez" : undefined}
              >
                {label}
              </button>
            );
          })}
        </div>
      </Field>

      <div className="mt-4">
        <Field label="Etiket">
          <input
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={kind === "income" ? "örn: Maaş" : "örn: Kira"}
            className={inputClass}
          />
        </Field>
      </div>

      <div className="mt-4 grid grid-cols-[1fr_100px] gap-3">
        <Field label="Tutar">
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="örn: 25000"
            className={inputClass}
          />
        </Field>
        <Field label="Para birimi">
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className={cn(inputClass, "cursor-pointer")}
          >
            {COMMON_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Field label="Başlangıç ayı">
          <input
            type="month"
            value={startYm}
            onChange={(e) => setStartYm(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Bitiş ayı">
          <div className="space-y-1.5">
            <input
              type="month"
              value={endYm}
              onChange={(e) => setEndYm(e.target.value)}
              disabled={openEnded}
              className={cn(inputClass, openEnded && "opacity-50 cursor-not-allowed")}
            />
            <label className="flex items-center gap-1.5 text-[11px] text-(--color-text-tertiary) cursor-pointer">
              <input
                type="checkbox"
                checked={openEnded}
                onChange={(e) => setOpenEnded(e.target.checked)}
                className="accent-(--color-accent)"
              />
              Açık uçlu (sonsuza kadar)
            </label>
          </div>
        </Field>
      </div>

      <div className="mt-4">
        <Field label="Not (opsiyonel)">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="ek bilgi"
            className={inputClass}
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
          {isEdit ? "Kaydet" : "Ekle"}
        </button>
      </div>
    </ModalShell>
  );
}
