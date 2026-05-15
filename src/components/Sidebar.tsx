import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import {
  Settings,
  HelpCircle,
  LayoutDashboard,
  Plus,
  Trash2,
  Pin,
  PinOff,
  Pencil,
  Wallet as WalletIcon,
  PiggyBank,
  Bell,
  Home,
  ChevronDown,
  Check,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "../lib/cn";
import { usePortfolioStore } from "../stores/portfolioStore";
import { useBudgetStore } from "../stores/budgetStore";
import { useProfileStore } from "../stores/profileStore";
import { useUIStore } from "../stores/uiStore";
import { CreatePortfolioModal } from "./CreatePortfolioModal";
import { CreateBudgetModal } from "./CreateBudgetModal";
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
  // Profil başına en fazla 1 bütçe — başlık her zaman tekil "Bütçe"
  const budgetGroupTitle = "Bütçe";
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
      {/* Anasayfa — sidebar'ın en prominent giriş noktası */}
      <button
        onClick={goHome}
        className={cn(
          "flex h-14 w-full items-center gap-2.5 border-b border-(--color-border-subtle) px-3 text-left transition-colors",
          view.kind === "home"
            ? "bg-(--color-bg-hover) text-(--color-text-primary)"
            : "text-(--color-text-primary) hover:bg-(--color-bg-hover)"
        )}
      >
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-(--color-accent)/15 text-(--color-accent)">
          <Home className="h-4 w-4" strokeWidth={2.5} />
        </div>
        <span className="text-sm font-semibold tracking-tight">Anasayfa</span>
      </button>

      {/* Profil seçici — kompakt chip */}
      <div className="relative px-3 pt-2.5">
        <button
          onClick={() => setProfileMenuOpen((v) => !v)}
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors hover:bg-(--color-bg-hover)"
        >
          <User className="h-3 w-3 text-(--color-text-tertiary)" />
          <span className="flex-1 truncate text-xs text-(--color-text-secondary)">
            {activeProfile?.name ?? "Profil"}
          </span>
          <ChevronDown className="h-3 w-3 text-(--color-text-tertiary)" />
        </button>

        {profileMenuOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setProfileMenuOpen(false)}
            />
            <div className="absolute left-3 right-3 top-9 z-50 overflow-hidden rounded-lg border border-(--color-border-subtle) bg-(--color-bg-panel) py-1 text-sm shadow-2xl shadow-black/50">
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

      {/* Portföyler */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        <GroupHeader
          title={portfolioGroupTitle}
          onAdd={() => openModal(<CreatePortfolioModal />)}
        />
        <ul className="space-y-0.5">
          {!showSingle && (
            <NavItem
              label="Hepsi"
              icon={<LayoutDashboard className="h-3.5 w-3.5" />}
              active={activePortfolioId === null && view.kind === "dashboard"}
              onClick={() => onSelectPortfolio(null)}
            />
          )}
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

        {/* Bütçe — profil başına 1 tane */}
        <div className="mt-6">
          <div className="flex items-center justify-between px-2 pb-2">
            <span className="text-[11px] font-medium tracking-[0.05em] text-(--color-text-tertiary) uppercase">
              {budgetGroupTitle}
            </span>
            {budgets.length === 0 && (
              <button
                onClick={() => openModal(<CreateBudgetModal />)}
                aria-label="Yeni bütçe"
                title="Yeni bütçe"
                className="grid h-5 w-5 place-items-center rounded-md text-(--color-text-tertiary) transition-colors hover:bg-(--color-bg-hover) hover:text-(--color-text-primary)"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
              </button>
            )}
          </div>
          <ul className="space-y-0.5">
            {budgets.length === 0 && (
              <li className="px-3 py-2 text-xs text-(--color-text-tertiary)">
                henüz bütçe yok
              </li>
            )}
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
                      "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors duration-150",
                      active
                        ? "bg-(--color-bg-hover) text-(--color-text-primary)"
                        : "text-(--color-text-secondary) hover:bg-(--color-bg-hover) hover:text-(--color-text-primary)"
                    )}
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      {b.pinned === 1 && (
                        <Pin className="h-3 w-3 text-(--color-accent)" fill="currentColor" />
                      )}
                      <WalletIcon className="h-3.5 w-3.5 text-(--color-text-tertiary)" />
                      <span className="truncate">{b.name}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Yatırım — bütçeden bağımsız aylık birikim */}
        <div className="mt-6">
          <ul className="space-y-0.5">
            <NavItem
              label="Yatırım"
              icon={<PiggyBank className="h-3.5 w-3.5" />}
              active={view.kind === "investments"}
              onClick={goInvestments}
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
  onAdd,
}: {
  title: string;
  onAdd: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-2 pb-2">
      <span className="text-[11px] font-medium tracking-[0.05em] text-(--color-text-tertiary) uppercase">
        {title}
      </span>
      <button
        onClick={onAdd}
        aria-label={`Yeni ${title.toLowerCase()}`}
        title={`Yeni ${title.toLowerCase()}`}
        className="grid h-5 w-5 place-items-center rounded-md text-(--color-text-tertiary) transition-colors hover:bg-(--color-bg-hover) hover:text-(--color-text-primary)"
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
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        onClick={onClick}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors duration-150",
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
