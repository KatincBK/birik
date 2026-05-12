import { useState } from "react";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  ModalShell,
  Field,
  inputClass,
  buttonGhost,
  buttonPrimary,
  buttonSecondary,
} from "./Modal";
import { api } from "../lib/api";
import { useProfileStore } from "../stores/profileStore";
import { useBudgetStore } from "../stores/budgetStore";
import { useUIStore } from "../stores/uiStore";
import { playSound } from "../lib/sounds";
import { parseAmount } from "../lib/parseAmount";
import { cn } from "../lib/cn";

const CURRENCIES = ["USD", "TRY", "EUR", "GBP"];
const MONTH_LABELS = [
  "Oca", "Şub", "Mar", "Nis", "May", "Haz",
  "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara",
];

type MonthForm = {
  amount: string;
  currency: string;
  note: string;
  advanced: boolean;
  income: string;
  expense: string;
};

const blankForm = (defaultCurrency: string): MonthForm => ({
  amount: "",
  currency: defaultCurrency,
  note: "",
  advanced: false,
  income: "",
  expense: "",
});

function ymKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function ymLabel(ym: string): string {
  const [y, m] = ym.split("-");
  const idx = parseInt(m, 10) - 1;
  return `${MONTH_LABELS[idx] ?? m} ${y}`;
}


/**
 * Aylık tasarruf girişlerini topluca eklemek için sihirbaz:
 * 1) Çoklu ay seçimi (son 36 ay grid)
 * 2) Seçili aylar üzerinde sıralı form (tutar + currency + not, opsiyonel
 *    advanced ile gelir + gider — bütçe varsa bütçeye de yazılır)
 */
export function InvestmentImportModal() {
  const closeModal = useUIStore((s) => s.closeModal);
  const profileId = useProfileStore((s) => s.activeId);
  const budgets = useBudgetStore((s) => s.budgets);
  const activeBudget = budgets[0] ?? null;

  const [step, setStep] = useState<"select" | "fill">("select");
  const [selectedMonths, setSelectedMonths] = useState<Set<string>>(new Set());
  const [currentIdx, setCurrentIdx] = useState(0);
  const [forms, setForms] = useState<Record<string, MonthForm>>({});
  const [submitting, setSubmitting] = useState(false);

  const defaultCurrency = activeBudget?.currency ?? "USD";

  // Yıl gezgini — kullanıcı istediği yıla gidip ay seçer
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12
  const [viewYear, setViewYear] = useState(currentYear);

  const sortedSelected = [...selectedMonths].sort();

  const toggleMonth = (ym: string) => {
    setSelectedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(ym)) next.delete(ym);
      else next.add(ym);
      return next;
    });
  };

  const selectAllInView = () => {
    setSelectedMonths((prev) => {
      const next = new Set(prev);
      for (let m = 1; m <= 12; m++) {
        if (viewYear === currentYear && m > currentMonth) continue;
        next.add(ymKey(viewYear, m));
      }
      return next;
    });
  };
  const clearSelection = () => setSelectedMonths(new Set());

  const proceedToFill = () => {
    if (sortedSelected.length === 0) {
      toast.error("En az bir ay seçmelisin");
      playSound("error");
      return;
    }
    // Form verilerini başlat (mevcut olanları koruyor)
    setForms((prev) => {
      const next = { ...prev };
      for (const ym of sortedSelected) {
        if (!next[ym]) next[ym] = blankForm(defaultCurrency);
      }
      return next;
    });
    setCurrentIdx(0);
    setStep("fill");
  };

  const updateForm = (ym: string, patch: Partial<MonthForm>) => {
    setForms((prev) => ({
      ...prev,
      [ym]: { ...prev[ym], ...patch },
    }));
  };

  const onSubmitAll = async () => {
    if (profileId == null) {
      toast.error("Aktif profil yok");
      return;
    }
    // Tüm formlarda geçerli sayı var mı kontrol et — negatif kabul
    // (bazı aylar tasarruftan yenmiş olabilir).
    for (const ym of sortedSelected) {
      const f = forms[ym];
      const num = f ? parseAmount(f.amount) : null;
      if (num == null) {
        const idx = sortedSelected.indexOf(ym);
        toast.error(`${ymLabel(ym)} için geçerli tutar gir`);
        setCurrentIdx(idx);
        playSound("error");
        return;
      }
    }

    setSubmitting(true);
    let invSaved = 0;
    let bgtSaved = 0;
    let failed = 0;
    for (const ym of sortedSelected) {
      const f = forms[ym];
      try {
        await api.upsertInvestmentEntry({
          profileId,
          yearMonth: ym,
          currency: f.currency,
          amount: parseAmount(f.amount) ?? 0,
          note: f.note.trim() || null,
        });
        invSaved += 1;

        if (f.advanced && activeBudget) {
          const inc = parseAmount(f.income) ?? 0;
          const exp = parseAmount(f.expense) ?? 0;
          if (inc > 0 || exp > 0) {
            await api.upsertBudgetEntry({
              budgetId: activeBudget.id,
              yearMonth: ym,
              income: inc,
              expense: exp,
              note: f.note.trim() || null,
              currency: f.currency,
            });
            bgtSaved += 1;
          }
        }
      } catch (err) {
        failed += 1;
        console.error(`[birik] import ${ym} fail:`, err);
      }
    }

    setSubmitting(false);
    if (failed > 0) {
      playSound("error");
      toast.error(`${failed} ay kaydedilemedi`, {
        description: `Yatırım: ${invSaved}, bütçe: ${bgtSaved}`,
      });
    } else {
      playSound("ding");
      const parts = [`${invSaved} yatırım`];
      if (bgtSaved > 0) parts.push(`${bgtSaved} bütçe`);
      toast.success(`${parts.join(" + ")} kaydedildi`);
      closeModal();
    }
  };

  /* ------------ Step 1: Ay seçimi ------------ */
  if (step === "select") {
    return (
      <ModalShell
        title="Tasarruf geçmişi ekle"
        description="Hangi aylar için kayıt eklemek istediğini seç"
        footer={
          <>
            <button onClick={closeModal} className={buttonGhost}>
              İptal
            </button>
            <button
              onClick={proceedToFill}
              disabled={sortedSelected.length === 0}
              className={buttonPrimary}
            >
              Devam ({sortedSelected.length})
            </button>
          </>
        }
      >
        {/* Yıl gezgini */}
        <div className="mb-3 flex items-center justify-between">
          <button
            onClick={() => setViewYear((y) => y - 1)}
            aria-label="Önceki yıl"
            className="grid h-8 w-8 place-items-center rounded-md text-(--color-text-secondary) transition-colors hover:bg-(--color-bg-hover) hover:text-(--color-text-primary)"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="text-base font-semibold tabular tracking-tight">
            {viewYear}
          </div>
          <button
            onClick={() => setViewYear((y) => y + 1)}
            aria-label="Sonraki yıl"
            disabled={viewYear >= currentYear}
            className="grid h-8 w-8 place-items-center rounded-md text-(--color-text-secondary) transition-colors hover:bg-(--color-bg-hover) hover:text-(--color-text-primary) disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-3 flex items-center justify-between text-xs">
          <span className="text-(--color-text-tertiary)">
            {sortedSelected.length} ay seçili
          </span>
          <div className="flex gap-1">
            <button
              onClick={selectAllInView}
              className="rounded px-2 py-1 text-(--color-text-secondary) transition-colors hover:bg-(--color-bg-hover) hover:text-(--color-text-primary)"
            >
              Bu yılı seç
            </button>
            <button
              onClick={clearSelection}
              className="rounded px-2 py-1 text-(--color-text-secondary) transition-colors hover:bg-(--color-bg-hover) hover:text-(--color-text-primary)"
            >
              Temizle
            </button>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-1.5">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
            const ym = ymKey(viewYear, m);
            const sel = selectedMonths.has(ym);
            const isFuture = viewYear === currentYear && m > currentMonth;
            return (
              <button
                key={ym}
                onClick={() => !isFuture && toggleMonth(ym)}
                disabled={isFuture}
                className={cn(
                  "rounded-lg border px-2 py-2 text-center text-xs font-medium tabular transition-colors",
                  sel
                    ? "border-(--color-accent)/50 bg-(--color-accent)/15 text-(--color-accent)"
                    : isFuture
                    ? "border-(--color-border-subtle)/40 bg-(--color-bg-base)/40 text-(--color-text-tertiary)/50 cursor-not-allowed"
                    : "border-(--color-border-subtle) bg-(--color-bg-base) text-(--color-text-secondary) hover:border-(--color-border-strong) hover:text-(--color-text-primary)"
                )}
              >
                {MONTH_LABELS[m - 1]}
              </button>
            );
          })}
        </div>

        {/* Diğer yıllarda seçili ay sayısı (kullanıcı görsün ki yıl atladığında kayıp olmadı) */}
        {(() => {
          const otherYearCounts = new Map<number, number>();
          for (const ym of sortedSelected) {
            const y = parseInt(ym.split("-")[0], 10);
            if (y !== viewYear) {
              otherYearCounts.set(y, (otherYearCounts.get(y) ?? 0) + 1);
            }
          }
          if (otherYearCounts.size === 0) return null;
          const entries = [...otherYearCounts.entries()].sort((a, b) => b[0] - a[0]);
          return (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {entries.map(([year, count]) => (
                <button
                  key={year}
                  onClick={() => setViewYear(year)}
                  className="inline-flex items-center gap-1 rounded-md border border-(--color-accent)/30 bg-(--color-accent)/10 px-2 py-1 text-[11px] text-(--color-accent) transition-colors hover:bg-(--color-accent)/20"
                >
                  {year}: {count} ay
                </button>
              ))}
            </div>
          );
        })()}
      </ModalShell>
    );
  }

  /* ------------ Step 2: Per-month form ------------ */
  const currentYM = sortedSelected[currentIdx];
  const f = forms[currentYM] ?? blankForm(defaultCurrency);
  const isLast = currentIdx === sortedSelected.length - 1;
  const canGoBack = currentIdx > 0;
  const advancedAvailable = activeBudget != null;

  return (
    <ModalShell
      title={`${ymLabel(currentYM)}`}
      description={`${currentIdx + 1} / ${sortedSelected.length} ay`}
      footer={
        <>
          <button
            onClick={() => setStep("select")}
            className={buttonGhost}
            disabled={submitting}
          >
            Aylara dön
          </button>
          <div className="flex-1" />
          {canGoBack && (
            <button
              onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
              className={`${buttonSecondary} inline-flex items-center gap-1`}
              disabled={submitting}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Önceki
            </button>
          )}
          {!isLast ? (
            <button
              onClick={() => setCurrentIdx((i) => i + 1)}
              className={`${buttonPrimary} inline-flex items-center gap-1`}
              disabled={submitting}
            >
              Sonraki
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              onClick={onSubmitAll}
              className={`${buttonPrimary} inline-flex items-center gap-1.5`}
              disabled={submitting}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {submitting
                ? "Kaydediliyor…"
                : `${sortedSelected.length} ay kaydet`}
            </button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {/* Progress göstergesi */}
        <div className="flex gap-1">
          {sortedSelected.map((ym, i) => (
            <button
              key={ym}
              onClick={() => setCurrentIdx(i)}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                i === currentIdx
                  ? "bg-(--color-accent)"
                  : i < currentIdx
                  ? "bg-(--color-accent)/40"
                  : "bg-(--color-border-subtle)"
              )}
              title={ymLabel(ym)}
            />
          ))}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Field label="Yatırım tutarı">
              <input
                autoFocus
                inputMode="decimal"
                value={f.amount}
                onChange={(e) => updateForm(currentYM, { amount: e.target.value })}
                placeholder="örn: 5000"
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="Para">
            <select
              value={f.currency}
              onChange={(e) => updateForm(currentYM, { currency: e.target.value })}
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

        <Field label="Not (opsiyonel)">
          <input
            value={f.note}
            onChange={(e) => updateForm(currentYM, { note: e.target.value })}
            placeholder="örn: bonus geldi, ek yatırım"
            className={inputClass}
          />
        </Field>

        {/* Advanced toggle — sadece bütçe varsa aktif */}
        <div className="rounded-lg border border-(--color-border-subtle) bg-(--color-bg-base)/40 p-3">
          <label
            className={cn(
              "flex items-center gap-2 text-sm",
              !advancedAvailable && "cursor-not-allowed opacity-60"
            )}
          >
            <input
              type="checkbox"
              checked={f.advanced && advancedAvailable}
              disabled={!advancedAvailable}
              onChange={(e) =>
                updateForm(currentYM, { advanced: e.target.checked })
              }
              className="h-4 w-4 accent-(--color-accent)"
            />
            <span className="font-medium">Gelir/gider de gir</span>
            <span className="text-xs text-(--color-text-tertiary)">
              {advancedAvailable
                ? "Bütçeye de yansıyacak"
                : "(önce bir bütçe oluştur)"}
            </span>
          </label>

          {f.advanced && advancedAvailable && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="Bu ayın geliri">
                <input
                  inputMode="decimal"
                  value={f.income}
                  onChange={(e) =>
                    updateForm(currentYM, { income: e.target.value })
                  }
                  placeholder="0"
                  className={inputClass}
                />
              </Field>
              <Field label="Bu ayın gideri">
                <input
                  inputMode="decimal"
                  value={f.expense}
                  onChange={(e) =>
                    updateForm(currentYM, { expense: e.target.value })
                  }
                  placeholder="0"
                  className={inputClass}
                />
              </Field>
            </div>
          )}
        </div>
      </div>
    </ModalShell>
  );
}
