import { useState } from "react";
import { RefreshCw, Volume2, VolumeX, WifiOff } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useStatsStore, statsKey } from "../stores/statsStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useOnline } from "../hooks/useOnline";
import { formatRelative } from "../lib/format";
import { cn } from "../lib/cn";
import { playSound } from "../lib/sounds";

type Props = {
  activeId: number | null;
  title: string;
};

export function TopBar({ activeId, title }: Props) {
  const key = statsKey(activeId);
  const refreshLive = useStatsStore((s) => s.refreshLive);
  const lastRefresh = useStatsStore((s) => s.lastRefresh[key] ?? null);
  const loading = useStatsStore((s) => s.loading[key] ?? false);
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const soundEnabled = useSettingsStore((s) => s.soundEnabled);
  const toggleSound = useSettingsStore((s) => s.toggleSound);
  const online = useOnline();
  const [spinKey, setSpinKey] = useState(0);

  const onRefresh = async () => {
    setSpinKey((k) => k + 1);
    try {
      await refreshLive(activeId, displayCurrency);
    } catch (err) {
      toast.error("Yenileme başarısız", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const lastLabel = lastRefresh
    ? `son yenileme ${formatRelative(lastRefresh)}`
    : "henüz yenilenmedi";

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-(--color-border-subtle) bg-(--color-bg-base) px-6">
      <div className="flex items-baseline gap-3">
        <h1 className="text-base font-semibold tracking-tight">{title}</h1>
        <span className="text-xs text-(--color-text-tertiary)">{lastLabel}</span>
        {!online && (
          <span className="inline-flex items-center gap-1 rounded-md border border-(--color-warning)/40 bg-(--color-warning)/10 px-2 py-0.5 text-[11px] font-medium text-(--color-warning)">
            <WifiOff className="h-3 w-3" />
            Çevrimdışı
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <kbd className="rounded-md border border-(--color-border-subtle) bg-(--color-bg-panel) px-2 py-1 text-[11px] font-medium text-(--color-text-secondary)">
          Ctrl K
        </kbd>
        <button
          onClick={() => {
            // Önce ses çıkar (önceki state hala enabled iken), sonra toggle.
            if (soundEnabled) {
              // mute'a geçiyoruz, son ses olarak click oynat
              playSound("click");
            }
            toggleSound();
            // mute'tan açmaya geçiyorsa, yeni state'le ding
            if (!soundEnabled) {
              setTimeout(() => playSound("ding"), 0);
            }
          }}
          aria-label={soundEnabled ? "Sesi kapat" : "Sesi aç"}
          title={soundEnabled ? "Sesi kapat" : "Sesi aç"}
          className="grid h-9 w-9 place-items-center rounded-lg border border-(--color-border-subtle) bg-(--color-bg-panel) text-(--color-text-secondary) transition-all duration-150 hover:bg-(--color-bg-hover) hover:text-(--color-text-primary) active:scale-95"
        >
          {soundEnabled ? (
            <Volume2 className="h-4 w-4" strokeWidth={2.25} />
          ) : (
            <VolumeX className="h-4 w-4 text-(--color-text-tertiary)" strokeWidth={2.25} />
          )}
        </button>
        <button
          onClick={onRefresh}
          disabled={loading}
          className={cn(
            "grid h-9 w-9 place-items-center rounded-lg border border-(--color-border-subtle) bg-(--color-bg-panel) text-(--color-text-secondary) transition-all duration-150 active:scale-95",
            loading
              ? "cursor-wait opacity-60"
              : "hover:bg-(--color-bg-hover) hover:text-(--color-text-primary)"
          )}
          title="Fiyatları yenile"
        >
          <motion.span
            key={spinKey}
            initial={{ rotate: 0 }}
            animate={{ rotate: 360 }}
            transition={{ duration: 0.8, ease: "linear" }}
            className="grid place-items-center"
          >
            <RefreshCw className="h-4 w-4" strokeWidth={2.25} />
          </motion.span>
        </button>
      </div>
    </header>
  );
}
