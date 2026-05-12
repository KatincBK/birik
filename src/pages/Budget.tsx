import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// Eski accent rengi — eksi tasarruf ay'ları için uyarı tonu (PriceChart vb.
// yeni mavi temada brand olarak kullanmıyor)
const NEG_ACCENT = "#FF8B7A";
import { Pencil, Trash2, Wallet, Target, PiggyBank } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "../components/Skeleton";
import { CreateBudgetModal } from "../components/CreateBudgetModal";
import {
  api,
  type Budget,
  type BudgetEntry,
  type BudgetProjection,
} from "../lib/api";
import { useBudgetStore } from "../stores/budgetStore";
import { useUIStore } from "../stores/uiStore";
import { buttonPrimary, buttonGhost } from "../components/Modal";
import { formatCurrency } from "../lib/format";
import { cn } from "../lib/cn";
import { playSound } from "../lib/sounds";

function thisMonthYM(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function daysToHumanLabel(months: number): string {
  if (months <= 0) return "ulaşıldı";
  if (months < 12) return `${months} ay`;
  const years = months / 12;
  if (years < 10) return `~${years.toFixed(1)} yıl`;
  return `~${Math.round(years)} yıl`;
}

export function Budget({ budgetId }: { budgetId: number }) {
  const budget = useBudgetStore((s) => s.budgets.find((b) => b.id === budgetId) ?? null);
  const setActive = useBudgetStore((s) => s.setActive);
  const removeBudget = useBudgetStore((s) => s.remove);
  const goHome = useUIStore((s) => s.goHome);
  const openModal = useUIStore((s) => s.openModal);

  const [entries, setEntries] = useState<BudgetEntry[]>([]);
  const [projection, setProjection] = useState<BudgetProjection | null>(null);
  const [loadingProj, setLoadingProj] = useState(true);

  // Aylık entry formu (bu ay için inline)
  const [entryYM, setEntryYM] = useState(thisMonthYM());
  const [entryIncome, setEntryIncome] = useState("");
  const [entryExpense, setEntryExpense] = useState("");
  const [entryNote, setEntryNote] = useState("");
  const [entryCurrency, setEntryCurrency] = useState<string>(budget?.currency ?? "USD");

  useEffect(() => {
    if (budget?.currency) setEntryCurrency(budget.currency);
  }, [budget?.currency]);

  useEffect(() => {
    setActive(budgetId);
  }, [budgetId, setActive]);

  const loadEntries = async () => {
    try {
      const list = await api.listBudgetEntries(budgetId);
      setEntries(list);
    } catch (err) {
      toast.error("Aylık kayıtlar yüklenemedi", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const loadProjection = async () => {
    setLoadingProj(true);
    try {
      const p = await api.projectBudget(budgetId);
      setProjection(p);
    } catch (err) {
      toast.error("Projeksyon hesaplanamadı", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoadingProj(false);
    }
  };

  useEffect(() => {
    if (!budget) return;
    loadEntries();
    loadProjection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [budgetId, budget?.monthly_income, budget?.monthly_expense, budget?.target_value]);

  if (!budget) {
    return (
      <div className="grid h-full place-items-center text-(--color-text-secondary)">
        Bütçe bulunamadı.
      </div>
    );
  }

  const onSubmitEntry = async () => {
    const inc = parseFloat(entryIncome.replace(",", ".")) || 0;
    const exp = parseFloat(entryExpense.replace(",", ".")) || 0;
    if (inc < 0 || exp < 0) {
      toast.error("Negatif değer giremezsin");
      playSound("error");
      return;
    }
    try {
      await api.upsertBudgetEntry({
        budgetId,
        yearMonth: entryYM,
        income: inc,
        expense: exp,
        note: entryNote.trim() || null,
        currency: entryCurrency,
      });
      playSound("ding");
      toast.success("Aylık kayıt güncellendi");
      setEntryIncome("");
      setEntryExpense("");
      setEntryNote("");
      await loadEntries();
      await loadProjection();
    } catch (err) {
      playSound("error");
      toast.error("Kayıt başarısız", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const onDeleteEntry = async (ym: string) => {
    if (!confirm(`${ym} ayının kaydı silinsin mi?`)) return;
    try {
      await api.deleteBudgetEntry(budgetId, ym);
      playSound("swoosh");
      await loadEntries();
    } catch (err) {
      playSound("error");
      toast.error("Silinemedi", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const onDeleteBudget = async () => {
    if (!confirm(`"${budget.name}" silinsin mi? Bu bütçe ve tüm aylık kayıtları kaybolur.`)) return;
    try {
      await removeBudget(budget.id);
      playSound("swoosh");
      toast.success("Bütçe silindi");
      goHome();
    } catch (err) {
      playSound("error");
      toast.error("Silinemedi", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const entryChartData = [...entries]
    .reverse()
    .map((e) => ({
      label: e.year_month,
      gelir: e.income,
      gider: e.expense,
      tasarruf: e.income - e.expense,
    }));

  // Geriye dönük göstergeler: toplam yatırım, yıllık ortalama.
  // Multi-currency varsa native toplama anlamsız → currency uyumsuzluğu flag'le.
  const insights = useMemo(() => {
    if (entries.length === 0) {
      return {
        total: 0,
        monthlyAvg: 0,
        annualAvg: 0,
        monthsCovered: 0,
        mixed: false,
        currency: budget?.currency ?? "USD",
      };
    }
    const currencies = new Set(
      entries.map((e) => (e.currency ?? budget?.currency ?? "USD").toUpperCase())
    );
    const mixed = currencies.size > 1;
    const total = entries.reduce((acc, e) => acc + (e.income - e.expense), 0);
    const months = entries.length;
    const monthlyAvg = total / months;
    return {
      total,
      monthlyAvg,
      annualAvg: monthlyAvg * 12,
      monthsCovered: months,
      mixed,
      currency: [...currencies][0] ?? budget?.currency ?? "USD",
    };
  }, [entries, budget?.currency]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <header className="flex items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-(--color-accent)/15 text-(--color-accent)">
            <Wallet className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{budget.name}</h1>
            <p className="text-sm text-(--color-text-secondary)">
              Aylık {formatCurrency(budget.monthly_income, budget.currency, "summary")} gelir •{" "}
              {formatCurrency(budget.monthly_expense, budget.currency, "summary")} gider
            </p>
          </div>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={() => openModal(<CreateBudgetModal existing={budget} />)}
            className={`${buttonGhost} inline-flex items-center gap-1.5`}
          >
            <Pencil className="h-4 w-4" />
            Düzenle
          </button>
          <button
            onClick={onDeleteBudget}
            className={`${buttonGhost} inline-flex items-center gap-1.5 text-(--color-danger)`}
          >
            <Trash2 className="h-4 w-4" />
            Sil
          </button>
        </div>
      </header>

      {/* Hedefe kalan tek bilgi — yatırım göstergeleri Yatırım sayfasına taşındı */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Stat
          icon={<Target className="h-4 w-4" />}
          label="Hedefe kalan"
          value={
            budget.target_value == null
              ? "Hedef yok"
              : projection?.months_to_target != null
              ? daysToHumanLabel(projection.months_to_target)
              : "Tempo yetersiz"
          }
          loading={loadingProj}
          accent={budget.target_value != null}
        />
        <Stat
          icon={<PiggyBank className="h-4 w-4" />}
          label="Aylık tasarruf"
          value={
            insights.monthsCovered === 0
              ? "—"
              : insights.mixed
              ? "Çoklu para"
              : formatCurrency(insights.monthlyAvg, insights.currency, "summary")
          }
          loading={false}
        />
      </div>

      {/* Aylık entry — formu + listesi + bar chart */}
      <Section title="Aylık takip">
        <div className="rounded-xl border border-(--color-border-subtle) bg-(--color-bg-panel) p-4">
          <h3 className="mb-3 text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
            Bu ayı kaydet / güncelle
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
            <input
              type="month"
              value={entryYM}
              onChange={(e) => setEntryYM(e.target.value)}
              className="rounded-lg border border-(--color-border-subtle) bg-(--color-bg-base) px-3 py-2 text-sm tabular outline-none focus:border-(--color-accent)"
            />
            <select
              value={entryCurrency}
              onChange={(e) => setEntryCurrency(e.target.value)}
              className="rounded-lg border border-(--color-border-subtle) bg-(--color-bg-base) px-3 py-2 text-sm outline-none focus:border-(--color-accent)"
              title="Bu ayın para birimi"
            >
              {["USD", "TRY", "EUR", "GBP"].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              inputMode="decimal"
              value={entryIncome}
              onChange={(e) => setEntryIncome(e.target.value)}
              placeholder="Gerçekleşen gelir"
              className="rounded-lg border border-(--color-border-subtle) bg-(--color-bg-base) px-3 py-2 text-sm tabular outline-none focus:border-(--color-accent)"
            />
            <input
              inputMode="decimal"
              value={entryExpense}
              onChange={(e) => setEntryExpense(e.target.value)}
              placeholder="Gerçekleşen gider"
              className="rounded-lg border border-(--color-border-subtle) bg-(--color-bg-base) px-3 py-2 text-sm tabular outline-none focus:border-(--color-accent)"
            />
            <input
              value={entryNote}
              onChange={(e) => setEntryNote(e.target.value)}
              placeholder="Not (ops.)"
              className="rounded-lg border border-(--color-border-subtle) bg-(--color-bg-base) px-3 py-2 text-sm outline-none focus:border-(--color-accent)"
            />
            <button onClick={onSubmitEntry} className={buttonPrimary}>
              Kaydet
            </button>
          </div>
          <p className="mt-2 text-[11px] text-(--color-text-tertiary)">
            Para birimi seçimi → o tarihteki USD kuru sabitlenir. Anasayfa kartları
            seçili display currency'ye dönüştürerek gösterir.
          </p>
        </div>

        {entries.length > 0 && (
          <>
            <div className="mt-4 rounded-xl border border-(--color-border-subtle) bg-(--color-bg-panel) p-4">
              <h3 className="mb-3 text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
                Aylık trend
              </h3>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={entryChartData}>
                    <CartesianGrid stroke="var(--color-border-subtle)" strokeDasharray="3 3" />
                    <XAxis dataKey="label" stroke="var(--color-text-tertiary)" tick={{ fontSize: 11 }} />
                    <YAxis stroke="var(--color-text-tertiary)" tick={{ fontSize: 11 }} />
                    <Tooltip
                      cursor={{ fill: "rgba(255,255,255,0.04)" }}
                      contentStyle={{
                        background: "var(--color-bg-panel)",
                        border: "1px solid var(--color-border-subtle)",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(v) =>
                        formatCurrency(Number(v), budget.currency, "summary")
                      }
                    />
                    <Bar dataKey="gelir" fill="#10B981" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="gider" fill="#DC2626" radius={[4, 4, 0, 0]} />
                    <Bar
                      dataKey="tasarruf"
                      shape={(props: any) => {
                        const negative = (props?.payload?.tasarruf ?? 0) < 0;
                        const fill = negative ? NEG_ACCENT : "#6FD3EC";
                        const h = Math.abs(props.height ?? 0);
                        const y = (props.height ?? 0) < 0 ? props.y + props.height : props.y;
                        return (
                          <rect
                            x={props.x}
                            y={y}
                            width={props.width}
                            height={h}
                            rx={4}
                            ry={4}
                            fill={fill}
                          />
                        );
                      }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="mt-4 overflow-hidden rounded-xl border border-(--color-border-subtle) bg-(--color-bg-panel)">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-(--color-border-subtle) bg-(--color-bg-base)/40 text-(--color-text-tertiary)">
                    <Th>Ay</Th>
                    <Th align="right">Gelir</Th>
                    <Th align="right">Gider</Th>
                    <Th align="right">Tasarruf</Th>
                    <Th>Not</Th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => {
                    const saving = e.income - e.expense;
                    const ccy = e.currency ?? budget.currency;
                    return (
                      <tr
                        key={e.year_month}
                        className="border-b border-(--color-border-subtle) last:border-b-0"
                      >
                        <Td>
                          <div className="flex items-center gap-2">
                            <span>{e.year_month}</span>
                            <span className="rounded bg-(--color-bg-base) px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-(--color-text-tertiary)">
                              {ccy}
                            </span>
                          </div>
                        </Td>
                        <Td align="right" className="tabular text-(--color-success)">
                          {formatCurrency(e.income, ccy, "summary")}
                        </Td>
                        <Td align="right" className="tabular text-(--color-danger)">
                          {formatCurrency(e.expense, ccy, "summary")}
                        </Td>
                        <Td
                          align="right"
                          className={cn(
                            "tabular font-medium",
                            saving < 0 && "text-[#FF8B7A]"
                          )}
                        >
                          {formatCurrency(saving, ccy, "summary")}
                        </Td>
                        <Td className="text-(--color-text-secondary)">
                          {e.note ?? <span className="text-(--color-text-tertiary)">—</span>}
                        </Td>
                        <Td>
                          <button
                            onClick={() => onDeleteEntry(e.year_month)}
                            aria-label="Sil"
                            className="text-(--color-text-tertiary) transition-colors hover:text-(--color-danger)"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
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
    <section>
      <h2 className="mb-3 text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Stat({
  icon,
  label,
  value,
  loading,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  loading: boolean;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-(--color-border-subtle) bg-(--color-bg-panel) px-4 py-3",
        accent && "border-(--color-accent)/30"
      )}
    >
      <div className="flex items-center gap-1.5 text-(--color-text-secondary)">
        {icon}
        <span className="text-[11px] font-medium tracking-[0.05em] uppercase">
          {label}
        </span>
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-6 w-24" />
      ) : (
        <div className="mt-1 text-base font-semibold tabular">{value}</div>
      )}
    </div>
  );
}

function Th({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: "right";
}) {
  return (
    <th
      className={cn(
        "px-4 py-2.5 text-[11px] font-medium tracking-[0.05em] uppercase",
        align === "right" ? "text-right" : "text-left"
      )}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
  className,
}: {
  children: React.ReactNode;
  align?: "right";
  className?: string;
}) {
  return (
    <td
      className={cn(
        "px-4 py-3",
        align === "right" ? "text-right" : "text-left",
        className
      )}
    >
      {children}
    </td>
  );
}
