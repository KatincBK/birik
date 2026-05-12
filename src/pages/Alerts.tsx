import { useEffect, useState } from "react";
import { Bell, Plus, Trash2, ArrowUp, ArrowDown, CheckCircle2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "../components/Skeleton";
import { CreateAlertModal } from "../components/CreateAlertModal";
import { api, type PriceAlert, type Asset } from "../lib/api";
import { useUIStore } from "../stores/uiStore";
import { usePortfolioStore } from "../stores/portfolioStore";
import { useAssetStore } from "../stores/assetStore";
import { buttonPrimary } from "../components/Modal";
import { formatCurrency, formatRelative } from "../lib/format";
import { playSound } from "../lib/sounds";

export function Alerts() {
  const openModal = useUIStore((s) => s.openModal);
  const portfolios = usePortfolioStore((s) => s.portfolios);
  const assetsByPortfolio = useAssetStore((s) => s.byPortfolio);
  const refreshAssets = useAssetStore((s) => s.refresh);

  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshList = async () => {
    setLoading(true);
    try {
      const list = await api.listAlerts(null, false);
      setAlerts(list);
    } catch (err) {
      toast.error("Alarmlar yüklenemedi", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    portfolios.forEach((p) => refreshAssets(p.id).catch(() => {}));
    refreshList();
  }, [portfolios, refreshAssets]);

  const allAssets: Asset[] = portfolios.flatMap(
    (p) => assetsByPortfolio[p.id] ?? []
  );

  const onDelete = async (id: number) => {
    try {
      await api.deleteAlert(id);
      playSound("swoosh");
      setAlerts((list) => list.filter((a) => a.id !== id));
      toast.success("Alarm silindi");
    } catch (err) {
      playSound("error");
      toast.error("Alarm silinemedi", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const active = alerts.filter((a) => a.active === 1);
  const triggered = alerts.filter((a) => a.active === 0);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-8">
      <header className="flex items-end justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-(--color-accent)/15 text-(--color-accent)">
            <Bell className="h-5 w-5" strokeWidth={2.25} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Alarmlar</h1>
            <p className="text-sm text-(--color-text-secondary)">
              Fiyat eşiklerini geçince OS bildirimi alırsın.
            </p>
          </div>
        </div>
        <button
          onClick={() =>
            openModal(<CreateAlertModal onCreated={refreshList} />)
          }
          className={`${buttonPrimary} inline-flex items-center gap-1.5`}
        >
          <Plus className="h-4 w-4" strokeWidth={2.5} />
          Alarm kur
        </button>
      </header>

      <Section title="Aktif">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : active.length === 0 ? (
          <Empty text='Henüz fiyat alarmı yok. Bir varlığa eşik koy, fiyat oraya gelince haber verelim.' />
        ) : (
          <ul className="space-y-2">
            {active.map((a) => (
              <AlertRow
                key={a.id}
                alert={a}
                asset={allAssets.find((x) => x.id === a.asset_id) ?? null}
                onDelete={() => onDelete(a.id)}
                onEdit={() =>
                  openModal(
                    <CreateAlertModal
                      onCreated={refreshList}
                      existing={a}
                    />
                  )
                }
              />
            ))}
          </ul>
        )}
      </Section>

      {triggered.length > 0 && (
        <Section title="Tetiklenmiş">
          <ul className="space-y-2">
            {triggered.map((a) => (
              <AlertRow
                key={a.id}
                alert={a}
                asset={allAssets.find((x) => x.id === a.asset_id) ?? null}
                onDelete={() => onDelete(a.id)}
                onEdit={() =>
                  openModal(
                    <CreateAlertModal
                      onCreated={refreshList}
                      existing={a}
                    />
                  )
                }
              />
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
        {title}
      </h3>
      {children}
    </div>
  );
}

function AlertRow({
  alert,
  asset,
  onDelete,
  onEdit,
}: {
  alert: PriceAlert;
  asset: Asset | null;
  onDelete: () => void;
  onEdit?: () => void;
}) {
  const isAbove = alert.condition === "above";
  const isTriggered = alert.active === 0;
  return (
    <li className="flex items-center justify-between rounded-xl border border-(--color-border-subtle) bg-(--color-bg-panel) px-4 py-3">
      <div className="flex items-center gap-3">
        <div
          className={`grid h-8 w-8 place-items-center rounded-lg ${
            isTriggered
              ? "bg-(--color-warning)/15 text-(--color-warning)"
              : isAbove
              ? "bg-(--color-success)/15 text-(--color-success)"
              : "bg-(--color-danger)/15 text-(--color-danger)"
          }`}
        >
          {isTriggered ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : isAbove ? (
            <ArrowUp className="h-4 w-4" />
          ) : (
            <ArrowDown className="h-4 w-4" />
          )}
        </div>
        <div>
          <div className="text-sm font-medium tabular">
            {asset?.symbol ?? "—"}{" "}
            <span className="font-normal text-(--color-text-secondary)">
              {isAbove ? "≥" : "≤"} {formatCurrency(alert.threshold, alert.currency, "summary")}
            </span>
          </div>
          <div className="text-xs text-(--color-text-tertiary)">
            {asset?.name ?? "varlık silinmiş"}
            {isTriggered && alert.triggered_at && (
              <> • tetiklendi {formatRelative(alert.triggered_at)}</>
            )}
            {!isTriggered && (
              <> • kuruldu {formatRelative(alert.created_at)}</>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {onEdit && (
          <button
            onClick={onEdit}
            aria-label="Düzenle"
            className="text-(--color-text-tertiary) transition-colors hover:text-(--color-text-primary)"
          >
            <Pencil className="h-4 w-4" />
          </button>
        )}
        <button
          onClick={onDelete}
          aria-label="Sil"
          className="text-(--color-text-tertiary) transition-colors hover:text-(--color-danger)"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-(--color-border-subtle) bg-(--color-bg-panel) px-6 py-10 text-center">
      <p className="text-sm text-(--color-text-secondary)">{text}</p>
    </div>
  );
}
