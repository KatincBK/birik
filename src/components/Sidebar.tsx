import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import {
  Settings,
  HelpCircle,
  Plus,
  Trash2,
  Pin,
  PinOff,
  Pencil,
  Wallet as WalletIcon,
  Briefcase,
  PiggyBank,
  Target,
  Bell,
  Check,
  User,
} from "lucide-react";
import birikLogo from "../assets/birik_logo.png";
import { toast } from "sonner";
import { cn } from "../lib/cn";
import { usePortfolioStore } from "../stores/portfolioStore";
import { useBudgetStore } from "../stores/budgetStore";
import { useProfileStore } from "../stores/profileStore";
import { useUIStore } from "../stores/uiStore";
import { CreatePortfolioModal } from "./CreatePortfolioModal";
import { playSound } from "../lib/sounds";

export function Sidebar() {
  const profiles = useProfileStore((s) => s.profiles);
  const activeProfileId = useProfileStore((s) => s.activeId);
  const setActiveProfile = useProfileStore((s) => s.setActive);
  const createProfile = useProfileStore((s) => s.create);
  const renameProfile = useProfileStore((s) => s.rename);
  const removeProfile = useProfileStore((s) => s.remove);

  const portfolios = usePortfolioStore((s) => s.portfolios);
  const activePortfolioId = usePortfolioStore((s) => s.activeId);
  const setActivePortfolio = usePortfolioStore((s) => s.setActive);
  const removePortfolio = usePortfolioStore((s) => s.remove);
  const pinPortfolio = usePortfolioStore((s) => s.setPinned);
  const renamePortfolioFn = usePortfolioStore((s) => s.rename);

  const budgets = useBudgetStore((s) => s.budgets);
  const activeBudgetId = useBudgetStore((s) => s.activeId);
  const removeBudget = useBudgetStore((s) => s.remove);
  const pinBudget = useBudgetStore((s) => s.setPinned);

  const view = useUIStore((s) => s.view);
  const goHome = useUIStore((s) => s.goHome);
  const goDashboard = useUIStore((s) => s.goDashboard);
  const goBudget = useUIStore((s) => s.goBudget);
  const goInvestments = useUIStore((s) => s.goInvestments);
  const goGoal = useUIStore((s) => s.goGoal);
  const goAlerts = useUIStore((s) => s.goAlerts);
  const goSettings = useUIStore((s) => s.goSettings);
  const openModal = useUIStore((s) => s.openModal);

  const [version, setVersion] = useState<string>("");
  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(""));
  }, []);

  const [ctxMenu, setCtxMenu] = useState<
    | {
        kind: "portfolio" | "budget";
        id: number;
        name: string;
        pinned: boolean;
        x: number;
        y: number;
      }
    | null
  >(null);


  // Context menu kapatma — boş yere tıklayınca veya esc
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

  const showSingle = portfolios.length === 1; // tek portföyde "Hepsi" gizli

  const onSelectPortfolio = (id: number | null) => {
    setActivePortfolio(id);
    goDashboard();
  };

  const onContextMenu = (
    e: React.MouseEvent,
    kind: "portfolio" | "budget",
    id: number,
    name: string,
    pinned: boolean
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ kind, id, name, pinned, x: e.clientX, y: e.clientY });
  };

  const onTogglePin = async () => {
    if (!ctxMenu) return;
    try {
      if (ctxMenu.kind === "portfolio") {
        await pinPortfolio(ctxMenu.id, !ctxMenu.pinned);
      } else {
        await pinBudget(ctxMenu.id, !ctxMenu.pinned);
      }
      playSound("click");
    } catch (err) {
      playSound("error");
      toast.error("Pin değiştirilemedi", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setCtxMenu(null);
    }
  };

  const onDelete = async () => {
    if (!ctxMenu) return;
    if (!confirm(`"${ctxMenu.name}" silinsin mi? Geri alınamaz.`)) return;
    try {
      if (ctxMenu.kind === "portfolio") {
        await removePortfolio(ctxMenu.id);
      } else {
        await removeBudget(ctxMenu.id);
      }
      playSound("swoosh");
      toast.success(`"${ctxMenu.name}" silindi`);
    } catch (err) {
      playSound("error");
      toast.error("Silinemedi", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setCtxMenu(null);
    }
  };

  const onRename = async () => {
    if (!ctxMenu || ctxMenu.kind !== "portfolio") {
      setCtxMenu(null);
      return;
    }
    const next = prompt("Yeni isim:", ctxMenu.name)?.trim();
    if (!next || next === ctxMenu.name) {
      setCtxMenu(null);
      return;
    }
    try {
      await renamePortfolioFn(ctxMenu.id, next);
      playSound("ding");
    } catch (err) {
      playSound("error");
      toast.error("Yeniden adlandırılamadı", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setCtxMenu(null);
    }
  };

  const portfolioGroupTitle = portfolios.length > 1 ? "Portföyler" : "Portföy";
  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? null;
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  const onCreateNewProfile = async () => {
    const name = prompt("Yeni profil adı:")?.trim();
    if (!name) return;
    try {
      const p = await createProfile(name);
      setActiveProfile(p.id);
      playSound("ding");
      toast.success(`"${p.name}" oluşturuldu`);
      setProfileMenuOpen(false);
    } catch (err) {
      playSound("error");
      toast.error("Profil oluşturulamadı", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const onRenameProfile = async () => {
    if (!activeProfile) return;
    const next = prompt("Profil adı:", activeProfile.name)?.trim();
    if (!next || next === activeProfile.name) return;
    try {
      await renameProfile(activeProfile.id, next);
      playSound("ding");
    } catch (err) {
      playSound("error");
      toast.error("Yeniden adlandırılamadı", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const onDeleteProfile = async () => {
    if (!activeProfile) return;
    if (
      !confirm(
        `"${activeProfile.name}" silinsin mi? Tüm portföyleri, bütçesi ve işlemleri kaybolur.`
      )
    )
      return;
    try {
      await removeProfile(activeProfile.id);
      playSound("swoosh");
      toast.success(`"${activeProfile.name}" silindi`);
    } catch (err) {
      playSound("error");
      toast.error("Silinemedi", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-(--color-border-subtle) bg-(--color-bg-panel)">
      {/* BIRIK marka butonu + sağında profil ikonu */}
      <div className="relative flex h-14 items-stretch border-b border-(--color-border-subtle)">
        <button
          onClick={goHome}
          className={cn(
            "flex flex-1 items-center gap-2.5 px-3 text-left transition-colors",
            view.kind === "home"
              ? "bg-(--color-bg-hover) text-(--color-text-primary)"
              : "text-(--color-text-primary) hover:bg-(--color-bg-hover)"
          )}
        >
          <img
            src={birikLogo}
            alt="Birik"
            className="h-8 w-8 select-none"
            draggable={false}
          />
          <span className="text-base font-bold tracking-tight">BIRIK</span>
        </button>
        <button
          onClick={() => setProfileMenuOpen((v) => !v)}
          title={activeProfile?.name ?? "Profil"}
          className={cn(
            "grid w-11 place-items-center border-l border-(--color-border-subtle) transition-colors",
            profileMenuOpen
              ? "bg-(--color-bg-hover) text-(--color-accent)"
              : "text-(--color-text-tertiary) hover:bg-(--color-bg-hover) hover:text-(--color-text-primary)"
          )}
        >
          <User className="h-4 w-4" />
        </button>

        {profileMenuOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setProfileMenuOpen(false)}
            />
            <div className="absolute right-2 top-12 z-50 w-56 overflow-hidden rounded-lg border border-(--color-border-subtle) bg-(--color-bg-panel) py-1 text-sm shadow-2xl shadow-black/50">
              <div className="px-3 pb-1 pt-1 text-[10px] font-medium tracking-[0.05em] text-(--color-text-tertiary) uppercase">
                Profiller
              </div>
              {profiles.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setActiveProfile(p.id);
                    setProfileMenuOpen(false);
                    playSound("click");
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-(--color-bg-hover)",
                    p.id === activeProfileId && "bg-(--color-bg-hover)"
                  )}
                >
                  <User className="h-3.5 w-3.5 text-(--color-text-tertiary)" />
                  <span className="flex-1 truncate">{p.name}</span>
                  {p.id === activeProfileId && (
                    <Check className="h-3.5 w-3.5 text-(--color-accent)" />
                  )}
                </button>
              ))}
              <div className="my-1 border-t border-(--color-border-subtle)" />
              <button
                onClick={onCreateNewProfile}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-(--color-text-secondary) transition-colors hover:bg-(--color-bg-hover) hover:text-(--color-text-primary)"
              >
                <Plus className="h-3.5 w-3.5" />
                Yeni profil
              </button>
              {activeProfile && (
                <>
                  <button
                    onClick={() => {
                      onRenameProfile();
                      setProfileMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-(--color-text-secondary) transition-colors hover:bg-(--color-bg-hover) hover:text-(--color-text-primary)"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Aktifi yeniden adlandır
                  </button>
                  {profiles.length > 1 && (
                    <button
                      onClick={() => {
                        onDeleteProfile();
                        setProfileMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-(--color-danger) transition-colors hover:bg-(--color-danger)/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Aktifi sil
                    </button>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Portföyler — başlık tıklanınca "Hepsi" görünümü açılır */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        <GroupHeader
          title={portfolioGroupTitle.toUpperCase()}
          icon={<Briefcase className="h-3.5 w-3.5" />}
          onAdd={() => openModal(<CreatePortfolioModal />)}
          onTitleClick={showSingle ? undefined : () => onSelectPortfolio(null)}
          titleActive={
            !showSingle &&
            activePortfolioId === null &&
            view.kind === "dashboard"
          }
        />
        <ul className="space-y-0.5">
          {portfolios.map((p) => {
            const active = p.id === activePortfolioId && view.kind === "dashboard";
            return (
              <li key={p.id}>
                <button
                  onClick={() => onSelectPortfolio(p.id)}
                  onContextMenu={(e) =>
                    onContextMenu(e, "portfolio", p.id, p.name, p.pinned === 1)
                  }
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors duration-150",
                    active
                      ? "bg-(--color-bg-hover) text-(--color-text-primary)"
                      : "text-(--color-text-secondary) hover:bg-(--color-bg-hover) hover:text-(--color-text-primary)"
                  )}
                >
                  <span className="flex items-center gap-1.5 truncate">
                    {p.pinned === 1 && (
                      <Pin className="h-3 w-3 text-(--color-accent)" fill="currentColor" />
                    )}
                    <span className="truncate">{p.name}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {/* Top-level nav: Bütçe + Yatırım + Hedef — hepsi bir listede,
            kendi aralarında space-y-0.5 ile eş aralıklı. */}
        <div className="mt-6">
          <ul className="space-y-0.5">
            {budgets.map((b) => {
              const active =
                b.id === activeBudgetId && view.kind === "budget";
              return (
                <li key={b.id}>
                  <button
                    onClick={() => goBudget(b.id)}
                    onContextMenu={(e) =>
                      onContextMenu(e, "budget", b.id, b.name, b.pinned === 1)
                    }
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-semibold uppercase tracking-[0.05em] transition-colors duration-150",
                      active
                        ? "bg-(--color-bg-hover) text-(--color-text-primary)"
                        : "text-(--color-text-secondary) hover:bg-(--color-bg-hover) hover:text-(--color-text-primary)"
                    )}
                  >
                    <WalletIcon className="h-3.5 w-3.5 text-(--color-text-tertiary)" />
                    <span className="flex-1 truncate">{b.name}</span>
                    {b.pinned === 1 && (
                      <Pin className="h-3 w-3 text-(--color-accent)" fill="currentColor" />
                    )}
                  </button>
                </li>
              );
            })}
            <NavItem
              label="Yatırım"
              icon={<PiggyBank className="h-3.5 w-3.5" />}
              active={view.kind === "investments"}
              onClick={goInvestments}
              prominent
            />
            <NavItem
              label="Hedef"
              icon={<Target className="h-3.5 w-3.5" />}
              active={view.kind === "goal"}
              onClick={goGoal}
              prominent
            />
          </ul>
        </div>

      </div>

      {/* Alarmlar (Ayarların hemen üstünde) */}
      <div className="border-t border-(--color-border-subtle) p-3">
        <button
          onClick={goAlerts}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors duration-150",
            view.kind === "alerts"
              ? "bg-(--color-bg-hover) text-(--color-text-primary)"
              : "text-(--color-text-secondary) hover:bg-(--color-bg-hover) hover:text-(--color-text-primary)"
          )}
        >
          <Bell className="h-4 w-4" />
          Alarmlar
        </button>
        <button
          onClick={goSettings}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors duration-150",
            view.kind === "settings"
              ? "bg-(--color-bg-hover) text-(--color-text-primary)"
              : "text-(--color-text-secondary) hover:bg-(--color-bg-hover) hover:text-(--color-text-primary)"
          )}
        >
          <Settings className="h-4 w-4" />
          Ayarlar
        </button>
        <button
          disabled
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-(--color-text-tertiary) opacity-60"
          title="İleride aktif olacak"
        >
          <HelpCircle className="h-4 w-4" />
          Yardım
        </button>
        {version && (
          <div className="mt-1 px-3 text-[10px] text-(--color-text-tertiary) tabular">
            v{version}
          </div>
        )}
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <div
          className="fixed z-50 min-w-[160px] overflow-hidden rounded-lg border border-(--color-border-subtle) bg-(--color-bg-panel) py-1 text-sm shadow-2xl shadow-black/50"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <CtxItem
            icon={
              ctxMenu.pinned ? (
                <PinOff className="h-3.5 w-3.5" />
              ) : (
                <Pin className="h-3.5 w-3.5" />
              )
            }
            label={ctxMenu.pinned ? "Pin'i kaldır" : "Pinle"}
            onClick={onTogglePin}
          />
          {ctxMenu.kind === "portfolio" && (
            <CtxItem
              icon={<Pencil className="h-3.5 w-3.5" />}
              label="Yeniden adlandır"
              onClick={onRename}
            />
          )}
          <CtxItem
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label="Sil"
            onClick={onDelete}
            danger
          />
        </div>
      )}
    </aside>
  );
}

function GroupHeader({
  title,
  icon,
  onAdd,
  onTitleClick,
  titleActive,
}: {
  title: string;
  icon: React.ReactNode;
  onAdd: () => void;
  onTitleClick?: () => void;
  titleActive?: boolean;
}) {
  // NavItem ile aynı görünüm + tıklama alanı: ikon ve metin tek button içinde,
  // tüm satır soldan tıklanabilir. + butonu sağda ayrı (overlay konumlu, satır
  // içinde yer kaplıyor ama button içine girmiyor).
  const labelClass = cn(
    "text-sm font-semibold uppercase tracking-[0.05em] transition-colors",
    titleActive
      ? "text-(--color-text-primary)"
      : "text-(--color-text-secondary)"
  );
  return (
    <div className="relative flex items-stretch">
      {onTitleClick ? (
        <button
          onClick={onTitleClick}
          className={cn(
            "flex flex-1 items-center gap-2.5 rounded-lg px-3 py-2 pr-9 text-left transition-colors duration-150 hover:bg-(--color-bg-hover) hover:text-(--color-text-primary)",
            titleActive && "bg-(--color-bg-hover)"
          )}
        >
          <span className="text-(--color-text-tertiary)">{icon}</span>
          <span className={labelClass}>{title}</span>
        </button>
      ) : (
        <div className="flex flex-1 items-center gap-2.5 px-3 py-2 pr-9">
          <span className="text-(--color-text-tertiary)">{icon}</span>
          <span className={labelClass}>{title}</span>
        </div>
      )}
      <button
        onClick={onAdd}
        aria-label={`Yeni ${title.toLowerCase()}`}
        title={`Yeni ${title.toLowerCase()}`}
        className="absolute right-2 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-md text-(--color-text-tertiary) transition-colors hover:bg-(--color-bg-hover) hover:text-(--color-text-primary)"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
      </button>
    </div>
  );
}

function NavItem({
  label,
  icon,
  active,
  onClick,
  prominent,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  prominent?: boolean;
}) {
  return (
    <li>
      <button
        onClick={onClick}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors duration-150",
          prominent && "font-semibold uppercase tracking-[0.05em]",
          active
            ? "bg-(--color-bg-hover) text-(--color-text-primary)"
            : "text-(--color-text-secondary) hover:bg-(--color-bg-hover) hover:text-(--color-text-primary)"
        )}
      >
        <span className="text-(--color-text-tertiary)">{icon}</span>
        {label}
      </button>
    </li>
  );
}

function CtxItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors",
        danger
          ? "text-(--color-danger) hover:bg-(--color-danger)/10"
          : "text-(--color-text-primary) hover:bg-(--color-bg-hover)"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
