import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from "recharts";
import {
  Pencil,
  Trash2,
  Wallet,
  Plus,
  ChevronDown,
  ChevronRight,
  EyeOff,
  Eye,
} from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "../components/Skeleton";
import { CreateBudgetModal } from "../components/CreateBudgetModal";
import { AddBudgetLineModal } from "../components/AddBudgetLineModal";
import {
  api,
  type BudgetLine,
  type BudgetMonthOverride,
  type MonthlyBudget,
} from "../lib/api";
import { useBudgetStore } from "../stores/budgetStore";
import { useUIStore } from "../stores/uiStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { buttonGhost, buttonPrimary, buttonSecondary } from "../components/Modal";
import { formatCurrency } from "../lib/format";
import { cn } from "../lib/cn";
import { playSound } from "../lib/sounds";

function thisMonthYM(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function ymToLabel(ym: string): string {
  const [y, m] = ym.split("-");
  const months = [
    "Oca", "Şub", "Mar", "Nis", "May", "Haz",
    "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara",
  ];
  const idx = parseInt(m, 10) - 1;
  return `${months[idx] ?? m} ${y}`;
}

function rangeLabel(start: string, end: string | null): string {
  if (!end) return `${ymToLabel(start)} → açık uçlu`;
  if (start === end) return ymToLabel(start);
  return `${ymToLabel(start)} – ${ymToLabel(end)}`;
}

export function Budget({ budgetId }: { budgetId: number }) {
  const budget = useBudgetStore((s) => s.budgets.find((b) => b.id === budgetId) ?? null);
  const setActive = useBudgetStore((s) => s.setActive);
  const removeBudget = useBudgetStore((s) => s.remove);
  const goHome = useUIStore((s) => s.goHome);
  const openModal = useUIStore((s) => s.openModal);
  const modal = useUIStore((s) => s.modal);
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const futureMonths = useSettingsStore((s) => s.budgetFutureMonths);

  const [lines, setLines] = useState<BudgetLine[]>([]);
  const [overrides, setOverrides] = useState<BudgetMonthOverride[]>([]);
  const [plan, setPlan] = useState<MonthlyBudget[] | null>(null);
  const [loading, setLoading] = useState(true);
  // Hangi ay+kind genişletilmiş? key = "YYYY-MM|income" | "YYYY-MM|expense"
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    setActive(budgetId);
  }, [budgetId, setActive]);

  const refresh = async () => {
    setLoading(true);
    try {
      const [l, o, p] = await Promise.all([
        api.listBudgetLines(budgetId),
        api.listBudgetMonthOverrides(budgetId),
        api.computeBudgetPlan({
          budgetId,
          displayCurrency,
          futureMonths,
        }),
      ]);
      setLines(l);
      setOverrides(o);
      setPlan(p.months);
    } catch (err) {
      toast.error("Yüklenemedi", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!budget) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [budgetId, displayCurrency, futureMonths]);

  // Modal kapanınca tazele (line modal kaydedince burası refetch eder)
  useEffect(() => {
    if (modal == null && budget != null) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal]);

  if (!budget) {
    return (
      <div className="grid h-full place-items-center text-(--color-text-secondary)">
        Bütçe bulunamadı.
      </div>
    );
  }

  const onDeleteBudget = async () => {
    if (!confirm(`"${budget.name}" silinsin mi? Tüm satırlar ve geçmiş kaybolur.`)) return;
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

  const onDeleteLine = async (line: BudgetLine) => {
    if (!confirm(`"${line.label}" satırı silinsin mi?`)) return;
    try {
      await api.deleteBudgetLine(line.id);
      playSound("swoosh");
      refresh();
    } catch (err) {
      playSound("error");
      toast.error("Silinemedi", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const onToggleInterpolate = async (ym: string) => {
    const cur = overrides.find((o) => o.year_month === ym);
    const next = !(cur && cur.interpolate === 1);
    try {
      await api.setBudgetMonthOverride({
        budgetId,
        yearMonth: ym,
        interpolate: next,
      });
      playSound("click");
      refresh();
    } catch (err) {
      playSound("error");
      toast.error("Güncellenemedi", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const toggleExpand = (ym: string, kind: "income" | "expense") => {
    const key = `${ym}|${kind}`;
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Bir ay için aktif line item'lar (start_ym ≤ ym ≤ end_ym | açık)
  const linesForMonth = (ym: string, kind: "income" | "expense"): BudgetLine[] =>
    lines.filter((l) => {
      if (l.kind !== kind) return false;
      if (l.start_ym > ym) return false;
      if (l.end_ym && l.end_ym < ym) return false;
      return true;
    });

  const chartData = useMemo(() => {
    if (!plan) return [];
    return plan.map((m) => ({
      ym: m.year_month,
      label: ymToLabel(m.year_month),
      income: m.income_display,
      expense: -m.expense_display, // negatif olarak göster — bar aşağıya
      net: m.net_display,
      is_interpolated: m.is_interpolated,
    }));
  }, [plan]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      {/* Header */}
      <header className="flex items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-(--color-accent)/15 text-(--color-accent)">
            <Wallet className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{budget.name}</h1>
            <p className="text-sm text-(--color-text-secondary)">
              Aylık gelir ve giderlerini satır satır planla. Her satır bir tarih
              aralığında her aya katkı yapar.
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

      {/* Chart */}
      <section className="rounded-xl border border-(--color-border-subtle) bg-(--color-bg-panel) p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
            Aylık özet ({displayCurrency})
          </h3>
          <div className="flex items-center gap-3 text-[11px] text-(--color-text-tertiary)">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-(--color-success)" />
              Gelir
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-(--color-danger)" />
              Gider
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-(--color-text-tertiary)" />
              Interpole
            </span>
          </div>
        </div>
        <div className="h-72">
          {loading ? (
            <Skeleton className="h-full w-full" />
          ) : chartData.length === 0 ? (
            <div className="grid h-full place-items-center text-center text-sm text-(--color-text-tertiary)">
              <p>
                Henüz satır eklemediğin için boş. Aşağıdan "Gelir" veya "Gider"
                ekle, grafik canlansın.
              </p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--color-border-subtle)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  stroke="var(--color-text-tertiary)"
                  tick={{ fontSize: 10 }}
                />
                <YAxis
                  stroke="var(--color-text-tertiary)"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v: number) =>
                    formatCurrency(Math.abs(v), displayCurrency, "summary")
                  }
                />
                <ReferenceLine y={0} stroke="var(--color-border-strong)" />
                <Tooltip
                  cursor={{ fill: "rgba(255,255,255,0.04)" }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0].payload as {
                      ym: string;
                      label: string;
                      income: number;
                      expense: number;
                      net: number;
                      is_interpolated: boolean;
                    };
                    return (
                      <div className="rounded-lg border border-(--color-border-subtle) bg-(--color-bg-panel) px-3 py-2 text-xs shadow-lg space-y-0.5">
                        <div className="font-semibold text-(--color-text-primary)">
                          {p.label}
                          {p.is_interpolated && (
                            <span className="ml-2 text-[10px] tracking-wide text-(--color-text-tertiary)">
                              (interpole)
                            </span>
                          )}
                        </div>
                        <div className="text-(--color-success)">
                          Gelir: {formatCurrency(p.income, displayCurrency, "summary")}
                        </div>
                        <div className="text-(--color-danger)">
                          Gider: {formatCurrency(Math.abs(p.expense), displayCurrency, "summary")}
                        </div>
                        <div
                          className={cn(
                            "border-t border-(--color-border-subtle) pt-1 mt-1 font-medium tabular",
                            p.net >= 0 ? "text-(--color-success)" : "text-(--color-danger)"
                          )}
                        >
                          Net: {formatCurrency(p.net, displayCurrency, "summary")}
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="income" radius={[4, 4, 0, 0]}>
                  {chartData.map((d, i) => (
                    <Cell
                      key={`inc-${i}`}
                      fill={d.is_interpolated ? "#6B6B75" : "#10B981"}
                    />
                  ))}
                </Bar>
                <Bar dataKey="expense" radius={[0, 0, 4, 4]}>
                  {chartData.map((d, i) => (
                    <Cell
                      key={`exp-${i}`}
                      fill={d.is_interpolated ? "#6B6B75" : "#DC2626"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      {/* Lines: aylar listesi */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
            Aylar
          </h3>
          <p className="text-[11px] text-(--color-text-tertiary)">
            İleri görünür ay: {futureMonths} (Ayarlar'dan değiştirilebilir)
          </p>
        </div>

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        ) : !plan || plan.length === 0 ? (
          <div className="rounded-xl border border-dashed border-(--color-border-subtle) bg-(--color-bg-panel)/40 px-5 py-8 text-center">
            <p className="text-sm text-(--color-text-secondary)">
              Henüz hiç satır yok. Bir gelir veya gider ekle.
            </p>
            <div className="mt-3 flex justify-center gap-2">
              <button
                onClick={() =>
                  openModal(
                    <AddBudgetLineModal budgetId={budgetId} defaultKind="income" />
                  )
                }
                className={`${buttonPrimary} inline-flex items-center gap-1.5`}
              >
                <Plus className="h-4 w-4" />
                Gelir ekle
              </button>
              <button
                onClick={() =>
                  openModal(
                    <AddBudgetLineModal budgetId={budgetId} defaultKind="expense" />
                  )
                }
                className={`${buttonSecondary} inline-flex items-center gap-1.5`}
              >
                <Plus className="h-4 w-4" />
                Gider ekle
              </button>
            </div>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {plan.map((m) => {
              const isCurrentMonth = m.year_month === thisMonthYM();
              const isPast = m.year_month < thisMonthYM();
              return (
                <li
                  key={m.year_month}
                  className={cn(
                    "rounded-xl border bg-(--color-bg-panel)",
                    isCurrentMonth
                      ? "border-(--color-accent)/40"
                      : "border-(--color-border-subtle)",
                    m.is_interpolated && "opacity-75"
                  )}
                >
                  {/* Ay başlığı */}
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span
                        className={cn(
                          "text-sm font-medium tabular",
                          isCurrentMonth && "text-(--color-accent)"
                        )}
                      >
                        {ymToLabel(m.year_month)}
                      </span>
                      {isCurrentMonth && (
                        <span className="rounded bg-(--color-accent)/15 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-(--color-accent)">
                          bu ay
                        </span>
                      )}
                      {m.is_interpolated && (
                        <span className="rounded bg-(--color-bg-base) px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-(--color-text-tertiary)">
                          interpole
                        </span>
                      )}
                    </div>
                    {isPast && (
                      <button
                        onClick={() => onToggleInterpolate(m.year_month)}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-(--color-text-tertiary) transition-colors hover:text-(--color-text-primary)"
                        title={
                          m.is_interpolated
                            ? "Bu ayı gerçek verileriyle göster"
                            : "Bu ayı komşulardan interpole et"
                        }
                      >
                        {m.is_interpolated ? (
                          <>
                            <Eye className="h-3 w-3" />
                            Gerçek değer
                          </>
                        ) : (
                          <>
                            <EyeOff className="h-3 w-3" />
                            Interpole et
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  {/* Income + Expense rows */}
                  <div className="border-t border-(--color-border-subtle)">
                    {(["income", "expense"] as const).map((kind) => {
                      const key = `${m.year_month}|${kind}`;
                      const isOpen = expanded.has(key);
                      const monthLines = linesForMonth(m.year_month, kind);
                      const total =
                        kind === "income" ? m.income_display : m.expense_display;
                      const label = kind === "income" ? "Gelir" : "Gider";
                      const color =
                        kind === "income"
                          ? "text-(--color-success)"
                          : "text-(--color-danger)";
                      return (
                        <div
                          key={kind}
                          className="border-b border-(--color-border-subtle) last:border-b-0"
                        >
                          <button
                            onClick={() => toggleExpand(m.year_month, kind)}
                            className="flex w-full items-center justify-between px-4 py-2 text-sm transition-colors hover:bg-(--color-bg-hover)"
                          >
                            <span className="flex items-center gap-2 text-(--color-text-secondary)">
                              {isOpen ? (
                                <ChevronDown className="h-3.5 w-3.5" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5" />
                              )}
                              {label}
                              <span className="text-[11px] text-(--color-text-tertiary)">
                                ({monthLines.length})
                              </span>
                            </span>
                            <span className={`tabular ${color}`}>
                              {formatCurrency(total, displayCurrency, "summary")}
                            </span>
                          </button>
                          {isOpen && (
                            <div className="border-t border-(--color-border-subtle) bg-(--color-bg-base)/30 px-4 py-2 space-y-1">
                              {monthLines.length === 0 ? (
                                <p className="px-2 py-1 text-xs text-(--color-text-tertiary)">
                                  Bu ay için {label.toLowerCase()} satırı yok.
                                </p>
                              ) : (
                                monthLines.map((l) => (
                                  <div
                                    key={l.id}
                                    className="flex items-center gap-3 rounded-md px-2 py-1 text-sm hover:bg-(--color-bg-hover)"
                                  >
                                    <span className="flex-1 truncate">{l.label}</span>
                                    <span className="tabular text-(--color-text-secondary)">
                                      {formatCurrency(l.amount, l.currency, "summary")}
                                    </span>
                                    <span className="text-[10px] text-(--color-text-tertiary) tracking-wide">
                                      {rangeLabel(l.start_ym, l.end_ym)}
                                    </span>
                                    <button
                                      onClick={() =>
                                        openModal(
                                          <AddBudgetLineModal
                                            budgetId={budgetId}
                                            existing={l}
                                          />
                                        )
                                      }
                                      className="text-(--color-text-tertiary) hover:text-(--color-text-primary)"
                                      title="Düzenle"
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      onClick={() => onDeleteLine(l)}
                                      className="text-(--color-text-tertiary) hover:text-(--color-danger)"
                                      title="Sil"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                ))
                              )}
                              <button
                                onClick={() =>
                                  openModal(
                                    <AddBudgetLineModal
                                      budgetId={budgetId}
                                      defaultKind={kind}
                                    />
                                  )
                                }
                                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-(--color-text-tertiary) transition-colors hover:text-(--color-accent)"
                              >
                                <Plus className="h-3 w-3" />
                                Yeni {label.toLowerCase()} ekle
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {/* Net */}
                    <div className="flex items-center justify-between border-t border-(--color-border-subtle) px-4 py-2 text-sm">
                      <span className="text-(--color-text-tertiary)">Net</span>
                      <span
                        className={cn(
                          "tabular font-medium",
                          m.net_display >= 0
                            ? "text-(--color-success)"
                            : "text-(--color-danger)"
                        )}
                      >
                        {formatCurrency(m.net_display, displayCurrency, "summary")}
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
