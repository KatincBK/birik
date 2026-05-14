import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Trash2,
  PiggyBank,
  TrendingUp,
  Coins,
  Plus,
  Pencil,
  Calculator,
} from "lucide-react";
import { toast } from "sonner";
import { api, type FxRates, type InvestmentEntry } from "../lib/api";
import { useProfileStore } from "../stores/profileStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useUIStore } from "../stores/uiStore";
import { buttonPrimary } from "../components/Modal";
import { Skeleton } from "../components/Skeleton";
import { InvestmentImportModal } from "../components/InvestmentImportModal";
import { EditInvestmentModal } from "../components/EditInvestmentModal";
import { formatCurrency } from "../lib/format";
import { cn } from "../lib/cn";
import { playSound } from "../lib/sounds";

/** TRY-pivot dönüşüm (backend `calc::convert` ile aynı mantık). */
function convertViaTry(
  amount: number,
  from: string,
  to: string,
  rates: Record<string, number> | null
): number {
  if (from.toUpperCase() === to.toUpperCase()) return amount;
  if (!rates) return amount;
  const toTry = (c: string) =>
    c.toUpperCase() === "TRY" ? 1 : rates[c.toUpperCase()] ?? 0;
  const f = toTry(from);
  const t = toTry(to);
  if (f === 0 || t === 0) return amount;
  return (amount * f) / t;
}

export function Investments() {
  const profileId = useProfileStore((s) => s.activeId);
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const openModal = useUIStore((s) => s.openModal);
  const modal = useUIStore((s) => s.modal);

  // Bugünkü FX rates — display currency dönüşümü ve historical-lock'u yok
  // entry'lerin USD'ye fallback dönüşümü için her zaman fetch.
  const [fxRates, setFxRates] = useState<FxRates | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .fetchFxRates()
      .then((r) => {
        if (!cancelled) setFxRates(r);
      })
      .catch(() => {
        if (!cancelled) setFxRates(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const [entries, setEntries] = useState<InvestmentEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const [ctxMenu, setCtxMenu] = useState<
    | { entry: InvestmentEntry; x: number; y: number }
    | null
  >(null);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [ctxMenu]);

  const onRowContextMenu = (e: React.MouseEvent, entry: InvestmentEntry) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ entry, x: e.clientX, y: e.clientY });
  };

  const refresh = async () => {
    if (profileId == null) return;
    setLoading(true);
    try {
      const list = await api.listInvestmentEntries(profileId);
      setEntries(list);
    } catch (err) {
      toast.error("Yatırım kayıtları yüklenemedi", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  // Modal kapanınca listeyi tazele (wizard'dan kaydedilmiş olabilir)
  useEffect(() => {
    if (modal == null) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal]);

  const onDelete = async (e: InvestmentEntry) => {
    if (!confirm(`${e.year_month} ${e.currency} kaydı silinsin mi?`)) return;
    try {
      await api.deleteInvestmentEntry(profileId!, e.year_month, e.currency);
      playSound("swoosh");
      await refresh();
    } catch (err) {
      playSound("error");
      toast.error("Silinemedi", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const entryUsd = (e: InvestmentEntry): number | null => {
    if (e.currency.toUpperCase() === "USD") return e.amount;
    if (e.fx_to_usd != null && e.fx_to_usd > 0) return e.amount * e.fx_to_usd;
    // Tarihsel kur kilitlenmemişse (Frankfurter fail) bugünkü FX ile fallback
    if (fxRates) {
      return convertViaTry(e.amount, e.currency, "USD", fxRates.rates);
    }
    return null;
  };

  const usdToDisplay = (usd: number): number =>
    displayCurrency.toUpperCase() === "USD"
      ? usd
      : convertViaTry(usd, "USD", displayCurrency, fxRates?.rates ?? null);

  // Aylık toplam — entryUsd helper'ı (fx_to_usd lock veya bugünkü FX fallback)
  const monthlyUsd = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) {
      const usd = entryUsd(e) ?? 0;
      map.set(e.year_month, (map.get(e.year_month) ?? 0) + usd);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => ({ ym: k, usd: v }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, fxRates]);

  // Chart için display currency'e dönüştürülmüş seri
  const monthlyDisplay = useMemo(
    () => monthlyUsd.map((m) => ({ ym: m.ym, value: usdToDisplay(m.usd) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [monthlyUsd, displayCurrency, fxRates]
  );

  // Kümülatif birikim — display currency'de
  const cumulativeDisplay = useMemo(() => {
    let sum = 0;
    return monthlyDisplay.map((m) => ({
      ym: m.ym,
      cumulative: (sum += m.value),
    }));
  }, [monthlyDisplay]);

  const [chartMode, setChartMode] = useState<"monthly" | "cumulative">("monthly");

  // Signed square root — log10'dan daha hafif sıkıştırma. 0 simetrik.
  // Bar yüksekliği transform edilmiş space'te, tooltip orijinal değer gösterir.
  const sqrtTransform = (v: number) => Math.sign(v) * Math.sqrt(Math.abs(v));
  const sqrtInverse = (t: number) => Math.sign(t) * t * t;

  const monthlySymlog = useMemo(
    () =>
      monthlyDisplay.map((m) => ({
        ym: m.ym,
        raw: m.value,
        display: sqrtTransform(m.value),
      })),
    [monthlyDisplay]
  );

  // Ay başına gruplama — bir ayın tüm currency'leri tek satırda chip olarak
  const groupedByMonth = useMemo(() => {
    const map = new Map<string, InvestmentEntry[]>();
    for (const e of entries) {
      if (!map.has(e.year_month)) map.set(e.year_month, []);
      map.get(e.year_month)!.push(e);
    }
    // DESC: en yeni ay üstte
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [entries]);

  const totals = useMemo(() => {
    const total = monthlyDisplay.reduce((acc, m) => acc + m.value, 0);
    const months = monthlyDisplay.length;
    const monthlyAvg = months > 0 ? total / months : 0;
    return { total, monthlyAvg, annualAvg: monthlyAvg * 12, months };
  }, [monthlyDisplay]);

  if (profileId == null) {
    return (
      <div className="grid h-full place-items-center text-(--color-text-secondary)">
        Aktif profil yok.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <header className="flex items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-(--color-accent)/15 text-(--color-accent)">
            <PiggyBank className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Yatırım</h1>
            <p className="text-sm text-(--color-text-secondary)">
              Her ay portföye koyduğun parayı döviz bazında kaydet. Tarihe göre
              USD kuru sabitlenir.
            </p>
          </div>
        </div>
        <button
          onClick={() => openModal(<InvestmentImportModal />)}
          className={`${buttonPrimary} inline-flex items-center gap-1.5`}
        >
          <Plus className="h-4 w-4" strokeWidth={2.5} />
          Tasarruf geçmişi ekle
        </button>
      </header>

      {/* Özet kartları — kullanıcının display currency'sinde */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat
          icon={<PiggyBank className="h-4 w-4" />}
          label={`Toplam yatırım (${totals.months} ay)`}
          value={
            totals.months > 0
              ? formatCurrency(totals.total, displayCurrency, "summary")
              : "—"
          }
        />
        <Stat
          icon={<Coins className="h-4 w-4" />}
          label="Aylık ortalama"
          value={
            totals.months > 0
              ? formatCurrency(totals.monthlyAvg, displayCurrency, "summary")
              : "—"
          }
        />
        <Stat
          icon={<TrendingUp className="h-4 w-4" />}
          label="Yıllık ortalama"
          value={
            totals.months > 0
              ? formatCurrency(totals.annualAvg, displayCurrency, "summary")
              : "—"
          }
        />
      </div>

      {/* Trend chart — Aylık (bar) ↔ Kümülatif (log line) */}
      {monthlyUsd.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
              {chartMode === "monthly"
                ? `Aylık birikim — log ölçek (${displayCurrency})`
                : `Toplam birikim — kümülatif (${displayCurrency})`}
            </h2>
            <div className="inline-flex gap-0.5 rounded-lg border border-(--color-border-subtle) bg-(--color-bg-panel) p-1">
              {(["monthly", "cumulative"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setChartMode(m)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                    chartMode === m
                      ? "border border-(--color-accent)/40 bg-(--color-accent)/15 text-(--color-accent)"
                      : "border border-transparent text-(--color-text-secondary) hover:text-(--color-text-primary)"
                  )}
                >
                  {m === "monthly" ? "Aylık" : "Toplam"}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-(--color-border-subtle) bg-(--color-bg-panel) p-4">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                {chartMode === "monthly" ? (
                  <BarChart data={monthlySymlog}>
                    <CartesianGrid stroke="var(--color-border-subtle)" strokeDasharray="3 3" />
                    <XAxis dataKey="ym" stroke="var(--color-text-tertiary)" tick={{ fontSize: 11 }} />
                    <YAxis
                      stroke="var(--color-text-tertiary)"
                      tick={{ fontSize: 11 }}
                      domain={["dataMin", "dataMax"]}
                      tickFormatter={(t: number) =>
                        formatCurrency(sqrtInverse(t), displayCurrency, "summary")
                      }
                    />
                    <Tooltip
                      cursor={{ fill: "rgba(255,255,255,0.04)" }}
                      contentStyle={{
                        background: "var(--color-bg-panel)",
                        border: "1px solid var(--color-border-subtle)",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const p = payload[0].payload as { ym: string; raw: number };
                        return (
                          <div className="rounded-lg border border-(--color-border-subtle) bg-(--color-bg-panel) px-3 py-2 text-xs">
                            <div className="text-base font-semibold tabular text-(--color-text-primary)">
                              {formatCurrency(p.raw, displayCurrency, "summary")}
                            </div>
                            <div className="mt-0.5 text-[11px] text-(--color-text-tertiary)">
                              {p.ym}
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Bar
                      dataKey="display"
                      shape={(props: any) => {
                        const negative = (props?.payload?.raw ?? 0) < 0;
                        const fill = negative ? "#FF8B7A" : "#6FD3EC";
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
                ) : (
                  <LineChart
                    data={cumulativeDisplay}
                    margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid stroke="var(--color-border-subtle)" strokeDasharray="3 3" />
                    <XAxis dataKey="ym" stroke="var(--color-text-tertiary)" tick={{ fontSize: 11 }} />
                    <YAxis
                      stroke="var(--color-text-tertiary)"
                      tick={{ fontSize: 11 }}
                      domain={["dataMin", "dataMax"]}
                      tickFormatter={(v: number) =>
                        formatCurrency(v, displayCurrency, "summary")
                      }
                    />
                    <Tooltip
                      cursor={{
                        stroke: "var(--color-border-strong)",
                        strokeDasharray: "3 3",
                      }}
                      contentStyle={{
                        background: "var(--color-bg-panel)",
                        border: "1px solid var(--color-border-subtle)",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(v) => formatCurrency(Number(v), displayCurrency, "summary")}
                    />
                    <Line
                      type="monotone"
                      dataKey="cumulative"
                      stroke="#6FD3EC"
                      strokeWidth={2.5}
                      dot={{ r: 3, fill: "#6FD3EC", strokeWidth: 0 }}
                      activeDot={{ r: 5, fill: "#6FD3EC", strokeWidth: 0 }}
                      isAnimationActive
                      animationDuration={400}
                      animationEasing="ease-out"
                    />
                  </LineChart>
                )}
              </ResponsiveContainer>
            </div>
            {chartMode === "monthly" && (
              <p className="mt-2 text-[11px] text-(--color-text-tertiary)">
                Y ekseni signed-sqrt — küçük ve büyük tutarlar arası sıkıştırma
                log'dan daha hafif. Negatif aylar (somon) ve pozitif aylar (mavi)
                aynı ölçekte, sıfır X ekseninde.
              </p>
            )}
          </div>
        </section>
      )}

      {/* Liste */}
      <section>
        <h2 className="mb-3 text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
          Kayıtlar
        </h2>
        {loading ? (
          <div className="space-y-2 rounded-xl border border-(--color-border-subtle) bg-(--color-bg-panel) p-4">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : entries.length === 0 ? (
          <div className="rounded-xl border border-dashed border-(--color-border-subtle) bg-(--color-bg-panel)/40 px-5 py-8 text-center">
            <p className="text-sm text-(--color-text-secondary)">
              Henüz yatırım kaydı yok.
            </p>
            <p className="mt-1 text-xs text-(--color-text-tertiary)">
              Üstteki "Tasarruf geçmişi ekle" ile birden fazla ayı tek seferde
              kaydedebilirsin.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-(--color-border-subtle) bg-(--color-bg-panel)">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-(--color-border-subtle) bg-(--color-bg-base)/40 text-(--color-text-tertiary)">
                  <Th>Ay</Th>
                  <Th>Tutarlar</Th>
                  <Th align="right">{displayCurrency} toplamı</Th>
                  <Th>Not</Th>
                </tr>
              </thead>
              <tbody>
                {groupedByMonth.map(([ym, items]) => {
                  const usdSum = items.reduce(
                    (s, e) => s + (entryUsd(e) ?? 0),
                    0
                  );
                  const displaySum = usdToDisplay(usdSum);
                  const notes = items
                    .map((e) => e.note)
                    .filter((n): n is string => !!n);
                  return (
                    <tr
                      key={ym}
                      className="border-b border-(--color-border-subtle) transition-colors last:border-b-0 hover:bg-(--color-bg-hover)"
                    >
                      <Td className="align-top">
                        <span className="tabular font-medium">{ym}</span>
                      </Td>
                      <Td className="align-top">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {items.map((e) => {
                            const negative = e.amount < 0;
                            return (
                              <button
                                key={e.currency}
                                onClick={() =>
                                  openModal(<EditInvestmentModal entry={e} />)
                                }
                                onContextMenu={(ev) => onRowContextMenu(ev, e)}
                                className={cn(
                                  "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs tabular transition-colors",
                                  negative
                                    ? "border-[#FF8B7A]/40 bg-[#FF8B7A]/10 text-[#FF8B7A] hover:bg-[#FF8B7A]/20"
                                    : "border-(--color-border-subtle) bg-(--color-bg-base) text-(--color-text-primary) hover:border-(--color-accent)/40 hover:bg-(--color-accent)/10 hover:text-(--color-accent)"
                                )}
                                title={
                                  e.amount_expr
                                    ? `İşlem: ${e.amount_expr} = ${formatCurrency(
                                        e.amount,
                                        e.currency,
                                        "summary"
                                      )}\nTık: düzenle • Sağ tık: menü`
                                    : "Tık: düzenle • Sağ tık: menü"
                                }
                              >
                                {e.amount_expr && (
                                  <Calculator className="h-3 w-3 shrink-0 opacity-50" />
                                )}
                                <span className="font-medium">
                                  {formatCurrency(e.amount, e.currency, "summary")}
                                </span>
                                <span className="text-[10px] tracking-wide opacity-70">
                                  {e.currency}
                                </span>
                              </button>
                            );
                          })}
                          <button
                            onClick={() =>
                              openModal(<EditInvestmentModal prefillYM={ym} />)
                            }
                            title={`${ym} ayına yeni currency ekle`}
                            className="inline-flex items-center gap-0.5 rounded-md border border-dashed border-(--color-border-subtle) px-2 py-0.5 text-xs text-(--color-text-tertiary) transition-colors hover:border-(--color-accent)/40 hover:text-(--color-accent)"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                      </Td>
                      <Td
                        align="right"
                        className={cn(
                          "tabular align-top",
                          displaySum < 0
                            ? "text-[#FF8B7A]"
                            : "text-(--color-text-secondary)"
                        )}
                      >
                        {formatCurrency(displaySum, displayCurrency, "summary")}
                      </Td>
                      <Td className="align-top text-(--color-text-secondary)">
                        {notes.length > 0 ? (
                          notes.join(" • ")
                        ) : (
                          <span className="text-(--color-text-tertiary)">—</span>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Sağ tık context menüsü */}
      {ctxMenu && (
        <div
          className="fixed z-50 min-w-[180px] overflow-hidden rounded-lg border border-(--color-border-subtle) bg-(--color-bg-panel) py-1 text-sm shadow-2xl shadow-black/50"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
          onClick={(ev) => ev.stopPropagation()}
        >
          <button
            onClick={() => {
              openModal(<EditInvestmentModal entry={ctxMenu.entry} />);
              setCtxMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-(--color-text-primary) transition-colors hover:bg-(--color-bg-hover)"
          >
            <Pencil className="h-3.5 w-3.5" />
            Düzenle
          </button>
          <button
            onClick={() => {
              const ym = ctxMenu.entry.year_month;
              openModal(<EditInvestmentModal prefillYM={ym} />);
              setCtxMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-(--color-text-primary) transition-colors hover:bg-(--color-bg-hover)"
          >
            <Plus className="h-3.5 w-3.5" />
            Yeni kayıt ekle ({ctxMenu.entry.year_month})
          </button>
          <div className="my-1 border-t border-(--color-border-subtle)" />
          <button
            onClick={() => {
              const e = ctxMenu.entry;
              setCtxMenu(null);
              onDelete(e);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-(--color-danger) transition-colors hover:bg-(--color-danger)/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Sil
          </button>
        </div>
      )}
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-(--color-border-subtle) bg-(--color-bg-panel) px-4 py-3">
      <div className="flex items-center gap-1.5 text-(--color-text-secondary)">
        {icon}
        <span className="text-[11px] font-medium tracking-[0.05em] uppercase">
          {label}
        </span>
      </div>
      <div className="mt-1 text-base font-semibold tabular">{value}</div>
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
