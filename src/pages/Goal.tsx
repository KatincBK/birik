import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Target, Wallet, PiggyBank, TrendingUp, Pencil, Plus } from "lucide-react";
import { Skeleton } from "../components/Skeleton";
import { CreateBudgetModal } from "../components/CreateBudgetModal";
import { EditTargetModal } from "../components/EditTargetModal";
import { api, type HomeSummary } from "../lib/api";
import { useProfileStore } from "../stores/profileStore";
import { useBudgetStore } from "../stores/budgetStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useUIStore } from "../stores/uiStore";
import { buttonPrimary, buttonSecondary } from "../components/Modal";
import { formatCurrency } from "../lib/format";
import { cn } from "../lib/cn";

const MAX_PROJECTION_MONTHS = 50 * 12; // 50 yıl üst sınırı — hesap patlamasın

// Aylık getiri oranı + sabit aylık katkı + başlangıç sermayesi ile hedefe
// ulaşma süresini ay cinsinden bul. Çözülemiyorsa null (örn. negatif katkı +
// hedef erişilmez).
function monthsToTarget(
  current: number,
  monthly: number,
  annualPct: number,
  target: number
): number | null {
  if (target <= current) return 0;
  if (monthly <= 0 && annualPct <= 0) return null;
  const r = Math.pow(1 + annualPct / 100, 1 / 12) - 1;
  if (Math.abs(r) < 1e-9) {
    // Faiz yok → düz birikim
    if (monthly <= 0) return null;
    return (target - current) / monthly;
  }
  // FV = C*(1+r)^n + m*((1+r)^n - 1)/r ⇒ (1+r)^n = (T*r+m)/(C*r+m)
  const num = target * r + monthly;
  const den = current * r + monthly;
  if (den <= 0 || num / den <= 0) return null;
  const n = Math.log(num / den) / Math.log(1 + r);
  if (!isFinite(n) || n < 0) return null;
  return n;
}

function formatDuration(months: number): string {
  if (months < 1) return "1 aydan az";
  const years = Math.floor(months / 12);
  const rem = Math.round(months - years * 12);
  if (years === 0) return `${rem} ay`;
  if (rem === 0) return `${years} yıl`;
  return `${years} yıl ${rem} ay`;
}

function monthsFromNow(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function Goal() {
  const profileId = useProfileStore((s) => s.activeId);
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const budgets = useBudgetStore((s) => s.budgets);
  const openModal = useUIStore((s) => s.openModal);
  const goBudget = useUIStore((s) => s.goBudget);
  const modal = useUIStore((s) => s.modal);
  const activeBudget = budgets[0] ?? null;

  const [summary, setSummary] = useState<HomeSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [overrideMonthly, setOverrideMonthly] = useState<string>("");
  const [overrideAnnual, setOverrideAnnual] = useState<string>("");

  useEffect(() => {
    if (profileId == null) return;
    let cancelled = false;
    setLoading(true);
    api
      .homeSummary(profileId, displayCurrency)
      .then((s) => {
        if (!cancelled) setSummary(s);
      })
      .catch(() => {
        if (!cancelled) setSummary(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profileId, displayCurrency, modal]);

  // Kullanıcı override girmişse onu kullan, yoksa gerçek veriyi
  const monthlyAvg =
    overrideMonthly.trim() !== "" && !isNaN(parseFloat(overrideMonthly))
      ? parseFloat(overrideMonthly)
      : summary?.monthly_investment_avg ?? 0;
  const annualPct =
    overrideAnnual.trim() !== "" && !isNaN(parseFloat(overrideAnnual))
      ? parseFloat(overrideAnnual)
      : summary?.cagr_pct ?? 0;
  const currentValue = summary?.total_value ?? 0;
  const targetValue = summary?.target_value ?? null;

  const months = useMemo(() => {
    if (targetValue == null) return null;
    return monthsToTarget(currentValue, monthlyAvg, annualPct, targetValue);
  }, [currentValue, monthlyAvg, annualPct, targetValue]);

  // Projeksiyon serisi — bugünden hedefe ulaşılana kadar (cap 50 yıl)
  const projection = useMemo(() => {
    if (targetValue == null || months == null) return [];
    const total = Math.min(Math.ceil(months) + 6, MAX_PROJECTION_MONTHS);
    const r = Math.pow(1 + annualPct / 100, 1 / 12) - 1;
    const out: { ym: string; value: number }[] = [];
    let v = currentValue;
    out.push({ ym: monthsFromNow(0), value: v });
    for (let i = 1; i <= total; i++) {
      v = v * (1 + r) + monthlyAvg;
      out.push({ ym: monthsFromNow(i), value: v });
    }
    return out;
  }, [currentValue, monthlyAvg, annualPct, targetValue, months]);

  if (profileId == null) {
    return (
      <div className="grid h-full place-items-center text-(--color-text-secondary)">
        Aktif profil yok.
      </div>
    );
  }

  // Hedef tanımlı değil — bütçe varsa hedef belirleme CTA, yoksa bütçe oluştur
  if (!loading && targetValue == null) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 px-6 py-12">
        <Header />
        <div className="rounded-2xl border border-dashed border-(--color-border-subtle) bg-(--color-bg-panel)/40 px-6 py-12 text-center">
          <Target className="mx-auto h-10 w-10 text-(--color-text-tertiary)" />
          <h2 className="mt-4 text-lg font-semibold">Henüz hedef belirlemedin</h2>
          <p className="mt-1 text-sm text-(--color-text-secondary)">
            {activeBudget
              ? "Hedef miktarı belirleyince ne zaman ulaşacağını burada görürsün."
              : "Önce bir bütçe oluşturup hedef miktarı belirle."}
          </p>
          <div className="mt-4 flex justify-center gap-2">
            {activeBudget ? (
              <>
                <button
                  onClick={() => openModal(<EditTargetModal budget={activeBudget} />)}
                  className={`${buttonPrimary} inline-flex items-center gap-1.5`}
                >
                  <Target className="h-4 w-4" />
                  Hedef belirle
                </button>
                <button
                  onClick={() => goBudget(activeBudget.id)}
                  className={`${buttonSecondary} inline-flex items-center gap-1.5`}
                >
                  Bütçeye git
                </button>
              </>
            ) : (
              <button
                onClick={() => openModal(<CreateBudgetModal />)}
                className={`${buttonPrimary} inline-flex items-center gap-1.5`}
              >
                <Plus className="h-4 w-4" />
                Bütçe oluştur
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const targetReached = months === 0;
  const unreachable = months == null && targetValue != null && !loading;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <Header />

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-56" />
        </div>
      ) : (
        <>
          {/* KPI kartları */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              icon={<Wallet className="h-4 w-4" />}
              label="Portföy büyüklüğü"
              value={formatCurrency(currentValue, displayCurrency, "summary")}
            />
            <Stat
              icon={<PiggyBank className="h-4 w-4" />}
              label="Aylık yatırım (ort.)"
              value={
                monthlyAvg > 0
                  ? formatCurrency(monthlyAvg, displayCurrency, "summary")
                  : "—"
              }
            />
            <Stat
              icon={<TrendingUp className="h-4 w-4" />}
              label="Yıllık getiri (ort.)"
              value={
                summary?.cagr_pct != null
                  ? `${annualPct >= 0 ? "+" : ""}${annualPct.toFixed(1)}%`
                  : "—"
              }
              valueClass={
                annualPct >= 0
                  ? "text-(--color-success)"
                  : "text-(--color-danger)"
              }
            />
            <Stat
              icon={<Target className="h-4 w-4" />}
              label="Hedef"
              value={formatCurrency(targetValue!, displayCurrency, "summary")}
              action={
                activeBudget
                  ? () => openModal(<EditTargetModal budget={activeBudget} />)
                  : undefined
              }
            />
          </div>

          {/* Ne zaman ulaşacağız — büyük headline */}
          <section className="rounded-2xl border border-(--color-border-subtle) bg-(--color-bg-panel) p-6">
            <div className="text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
              {targetReached
                ? "Hedefe ulaştın"
                : unreachable
                ? "Mevcut tempoyla ulaşılamıyor"
                : "Hedefe ulaşma süresi"}
            </div>
            <div className="mt-2 flex items-end gap-3">
              <div
                className={cn(
                  "text-4xl font-bold tracking-tight tabular sm:text-5xl",
                  targetReached
                    ? "text-(--color-success)"
                    : unreachable
                    ? "text-(--color-danger)"
                    : "text-(--color-text-primary)"
                )}
              >
                {targetReached
                  ? "🎉"
                  : unreachable
                  ? "—"
                  : formatDuration(months!)}
              </div>
              {!targetReached && !unreachable && months! > 0 && (
                <div className="pb-1.5 text-sm text-(--color-text-tertiary)">
                  ≈ {monthsFromNow(Math.round(months!))}
                </div>
              )}
            </div>
            {unreachable && (
              <p className="mt-3 text-sm text-(--color-text-secondary)">
                Hedefin mevcut portföy değerinin üstünde, ama aylık yatırım yok
                ve yıllık getirin negatif/sıfır. Aylık yatırımı veya beklenen
                getiriyi aşağıdan değiştirip senaryoları dene.
              </p>
            )}
          </section>

          {/* Senaryo override'ları */}
          <section className="rounded-xl border border-(--color-border-subtle) bg-(--color-bg-panel) p-4">
            <h3 className="text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
              Senaryo: farklı varsayımlar dene
            </h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <ScenarioField
                label={`Aylık yatırım (${displayCurrency})`}
                placeholder={String(
                  Math.round(summary?.monthly_investment_avg ?? 0)
                )}
                value={overrideMonthly}
                onChange={setOverrideMonthly}
                hint={
                  summary?.monthly_investment_avg != null
                    ? `Gerçek ort.: ${formatCurrency(summary.monthly_investment_avg, displayCurrency, "summary")}`
                    : "Henüz yatırım kaydı yok"
                }
              />
              <ScenarioField
                label="Yıllık getiri (%)"
                placeholder={
                  summary?.cagr_pct != null
                    ? summary.cagr_pct.toFixed(1)
                    : "10"
                }
                value={overrideAnnual}
                onChange={setOverrideAnnual}
                hint={
                  summary?.cagr_pct != null
                    ? `Gerçek CAGR: ${summary.cagr_pct.toFixed(1)}%`
                    : "Henüz hesaplanamadı"
                }
              />
            </div>
            {(overrideMonthly || overrideAnnual) && (
              <button
                onClick={() => {
                  setOverrideMonthly("");
                  setOverrideAnnual("");
                }}
                className="mt-3 text-xs text-(--color-text-tertiary) hover:text-(--color-accent)"
              >
                Sıfırla
              </button>
            )}
          </section>

          {/* Projeksiyon grafiği */}
          {projection.length > 1 && !unreachable && (
            <section>
              <h3 className="mb-3 text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
                Portföy projeksiyonu ({displayCurrency})
              </h3>
              <div className="rounded-xl border border-(--color-border-subtle) bg-(--color-bg-panel) p-4">
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={projection}
                      margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid
                        stroke="var(--color-border-subtle)"
                        strokeDasharray="3 3"
                      />
                      <XAxis
                        dataKey="ym"
                        stroke="var(--color-text-tertiary)"
                        tick={{ fontSize: 10 }}
                        interval="preserveStartEnd"
                        minTickGap={32}
                      />
                      <YAxis
                        stroke="var(--color-text-tertiary)"
                        tick={{ fontSize: 11 }}
                        domain={[0, "dataMax"]}
                        tickFormatter={(v: number) =>
                          formatCurrency(v, displayCurrency, "summary")
                        }
                      />
                      <ReferenceLine
                        y={targetValue!}
                        stroke="#F5C45C"
                        strokeDasharray="4 3"
                        label={{
                          value: "Hedef",
                          position: "right",
                          fill: "#F5C45C",
                          fontSize: 11,
                        }}
                      />
                      <Tooltip
                        cursor={{
                          stroke: "var(--color-border-strong)",
                          strokeDasharray: "3 3",
                        }}
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const p = payload[0].payload as {
                            ym: string;
                            value: number;
                          };
                          const reached = p.value >= targetValue!;
                          return (
                            <div className="rounded-lg border border-(--color-border-subtle) bg-(--color-bg-panel) px-3 py-2 text-xs space-y-0.5">
                              <div className="font-medium tabular text-(--color-text-primary)">
                                {p.ym}
                              </div>
                              <div className="tabular text-(--color-text-secondary)">
                                {formatCurrency(p.value, displayCurrency, "summary")}
                              </div>
                              {reached && (
                                <div className="text-(--color-success)">
                                  ✓ Hedef aşıldı
                                </div>
                              )}
                            </div>
                          );
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="value"
                        stroke="#6FD3EC"
                        strokeWidth={2.5}
                        dot={false}
                        activeDot={{ r: 5, fill: "#6FD3EC", strokeWidth: 0 }}
                        isAnimationActive
                        animationDuration={400}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-2 text-[11px] text-(--color-text-tertiary)">
                  Mavi çizgi: aylık yatırım + yıllık getiri ile büyüyen portföy.
                  Sarı kesik çizgi: hedef. İkisi kesiştiği nokta = ulaşma ayı.
                </p>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Header() {
  return (
    <header className="flex items-center gap-3">
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-(--color-accent)/15 text-(--color-accent)">
        <Target className="h-5 w-5" />
      </div>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Hedef</h1>
        <p className="text-sm text-(--color-text-secondary)">
          Portföy büyüklüğün + aylık yatırım + yıllık getiriyle hedefe ne zaman
          ulaşacağının projeksiyonu.
        </p>
      </div>
    </header>
  );
}

function Stat({
  icon,
  label,
  value,
  valueClass,
  action,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueClass?: string;
  action?: () => void;
}) {
  const inner = (
    <>
      <div className="flex items-center justify-between gap-2 text-(--color-text-secondary)">
        <div className="flex items-center gap-1.5">
          {icon}
          <span className="text-[10px] font-medium tracking-[0.05em] uppercase">
            {label}
          </span>
        </div>
        {action && (
          <Pencil className="h-3 w-3 text-(--color-text-tertiary) group-hover:text-(--color-accent)" />
        )}
      </div>
      <div className={cn("mt-1 text-base font-semibold tabular", valueClass)}>
        {value}
      </div>
    </>
  );
  if (action) {
    return (
      <button
        onClick={action}
        className="group rounded-xl border border-(--color-border-subtle) bg-(--color-bg-panel) px-4 py-3 text-left transition-colors hover:bg-(--color-bg-hover)"
      >
        {inner}
      </button>
    );
  }
  return (
    <div className="rounded-xl border border-(--color-border-subtle) bg-(--color-bg-panel) px-4 py-3">
      {inner}
    </div>
  );
}

function ScenarioField({
  label,
  placeholder,
  value,
  onChange,
  hint,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
        {label}
      </label>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-(--color-border-subtle) bg-(--color-bg-base) px-3 py-2 text-sm tabular text-(--color-text-primary) outline-none transition-colors focus:border-(--color-accent)/50"
      />
      {hint && (
        <p className="text-[10px] text-(--color-text-tertiary)">{hint}</p>
      )}
    </div>
  );
}
