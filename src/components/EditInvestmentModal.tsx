import { useState } from "react";
import { toast } from "sonner";
import {
  ModalShell,
  Field,
  inputClass,
  buttonGhost,
  buttonPrimary,
} from "./Modal";
import { api, type InvestmentEntry } from "../lib/api";
import { useProfileStore } from "../stores/profileStore";
import { useUIStore } from "../stores/uiStore";
import { parseAmount, isAmountFormula } from "../lib/parseAmount";
import { playSound } from "../lib/sounds";

const CURRENCIES = ["USD", "TRY", "EUR", "GBP"];

function thisMonthYM(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Tek bir yatırım kaydı için modal. Edit modunda mevcut kaydı günceller,
 * Add modunda yeni kayıt oluşturur. Tutar input'u formül destekler
 * (örn "100+200,50" → 300.50). Add'de aynı (ay, currency) varsa üzerine
 * yazılır (backend upsert).
 */
export function EditInvestmentModal({
  entry,
  prefillYM,
  onSaved,
}: {
  entry?: InvestmentEntry;
  /** Add modunda başlangıç ayı (örn ay satırının "+ ekle"sinden geldiyse) */
  prefillYM?: string;
  onSaved?: () => void;
}) {
  const closeModal = useUIStore((s) => s.closeModal);
  const profileId = useProfileStore((s) => s.activeId);
  const isEdit = entry != null;

  const [ym, setYM] = useState(entry?.year_month ?? prefillYM ?? thisMonthYM());
  const [currency, setCurrency] = useState(entry?.currency ?? "USD");
  // Düzenleme modunda kullanıcının yazdığı işlemi (varsa) olduğu gibi geri
  // yükle — yoksa hesaplanmış tutarı göster.
  const [amount, setAmount] = useState(
    entry?.amount_expr ?? (entry?.amount != null ? entry.amount.toString() : "")
  );
  const [note, setNote] = useState(entry?.note ?? "");
  const [submitting, setSubmitting] = useState(false);

  // Live preview: kullanıcı formül yazıyorsa hesaplanmış değer gözüksün
  const parsed = parseAmount(amount);
  const showPreview =
    amount.trim() !== "" && parsed != null && amount !== parsed.toString();

  const onSubmit = async () => {
    if (profileId == null) {
      toast.error("Aktif profil yok");
      return;
    }
    const value = parseAmount(amount);
    if (value == null) {
      playSound("error");
      toast.error("Geçerli bir tutar gir");
      return;
    }
    setSubmitting(true);
    try {
      const saved = await api.upsertInvestmentEntry({
        profileId,
        yearMonth: ym,
        currency: currency.toUpperCase(),
        amount: value,
        // İşlem yazıldıysa ham haliyle sakla — düz sayıysa saklama (null)
        amountExpr: isAmountFormula(amount) ? amount.trim() : null,
        note: note.trim() || null,
      });
      playSound("ding");
      toast.success(
        isEdit
          ? "Kayıt güncellendi"
          : `${saved.year_month} ${saved.currency} eklendi`
      );
      onSaved?.();
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
      title={isEdit ? "Yatırım kaydını düzenle" : "Yeni yatırım kaydı"}
      description={
        isEdit
          ? `${entry.year_month} • ${entry.currency}`
          : "Tek bir ay için kayıt — aynı ay+currency varsa üzerine yazılır"
      }
      footer={
        <>
          <button onClick={closeModal} className={buttonGhost} disabled={submitting}>
            İptal
          </button>
          <button
            onClick={onSubmit}
            disabled={submitting}
            className={buttonPrimary}
          >
            {isEdit ? "Kaydet" : "Ekle"}
          </button>
        </>
      }
    >
      {isEdit ? (
        // Edit modunda ay+currency primary key olduğu için sabit görünür.
        // Değiştirilemez — kullanıcı başka ay/currency için yeni kayıt eklemeli.
        <div className="flex items-center gap-2 rounded-lg border border-(--color-border-subtle) bg-(--color-bg-base)/40 px-3 py-2.5">
          <span className="text-base font-semibold tabular tracking-tight">
            {ym}
          </span>
          <span className="rounded bg-(--color-bg-panel) px-2 py-0.5 text-[11px] font-medium tracking-wide text-(--color-text-secondary)">
            {currency}
          </span>
          <span className="ml-auto text-[11px] text-(--color-text-tertiary)">
            sabit — başka kayıt için yeni ekle
          </span>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Field label="Ay">
              <input
                type="month"
                value={ym}
                onChange={(e) => setYM(e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="Para">
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className={inputClass}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}

      <div className="mt-3">
        <Field
          label="Tutar"
          hint="İşlem de yazabilirsin: 100+200, 1.500-300, vb. — işlem saklanır, sonra düzenleyebilirsin"
        >
          <input
            autoFocus
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="örn: 5000 veya 3000+1500+500"
            className={inputClass}
          />
        </Field>
        {showPreview && (
          <div className="mt-1 text-xs text-(--color-accent) tabular">
            = {parsed!.toLocaleString("tr-TR")} {currency}
          </div>
        )}
      </div>

      <div className="mt-3">
        <Field label="Not (opsiyonel)">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="örn: bonus, ek yatırım"
            className={inputClass}
          />
        </Field>
      </div>

    </ModalShell>
  );
}
