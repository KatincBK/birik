import { useEffect, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useUIStore } from "../stores/uiStore";

/**
 * Modal slot — tek seferde tek modal görünür. uiStore.modal ReactNode
 * tutar, ModalSlot bunu render eder. Esc ile kapanır, backdrop click ile.
 *
 * Animasyon Faz 5'te detaylanacak; şu an PLAN §4.4'teki standart 250ms
 * cubic-bezier(0.16, 1, 0.3, 1) eğrisiyle scale+fade.
 */
export function ModalSlot() {
  const modal = useUIStore((s) => s.modal);
  const closeModal = useUIStore((s) => s.closeModal);

  useEffect(() => {
    if (!modal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modal, closeModal]);

  return (
    <AnimatePresence>
      {modal && (
        <motion.div
          key="overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm"
          onClick={closeModal}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg max-h-[90vh] overflow-hidden rounded-2xl border border-(--color-border-subtle) bg-(--color-bg-panel) shadow-2xl shadow-black/40"
          >
            {modal}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Modal içeriği için iskelet — başlık, kapatma butonu, body, footer slot'ları.
 * Modal içerik component'leri bunu kullanır.
 */
export function ModalShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const closeModal = useUIStore((s) => s.closeModal);
  return (
    <div className="flex max-h-[90vh] flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-(--color-border-subtle) px-6 py-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          {description && (
            <p className="mt-0.5 text-sm text-(--color-text-secondary)">
              {description}
            </p>
          )}
        </div>
        <button
          onClick={closeModal}
          aria-label="Kapat"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-(--color-text-secondary) transition-colors hover:bg-(--color-bg-hover) hover:text-(--color-text-primary) active:scale-95"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>

      {footer && (
        <div className="flex items-center justify-end gap-2 border-t border-(--color-border-subtle) px-6 py-4">
          {footer}
        </div>
      )}
    </div>
  );
}

/* Common form primitives, Faz 4'te modal'larda kullanılıyor. */

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-medium tracking-[0.05em] text-(--color-text-secondary) uppercase">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-(--color-text-tertiary)">{hint}</p>}
    </div>
  );
}

export const inputClass =
  "w-full rounded-lg border border-(--color-border-subtle) bg-(--color-bg-base) px-3 py-2 text-sm tabular text-(--color-text-primary) outline-none transition-colors placeholder:text-(--color-text-tertiary) focus:border-(--color-accent)";

export const buttonPrimary =
  "rounded-lg bg-(--color-accent) px-4 py-2 text-sm font-medium text-(--color-bg-base) transition-all duration-150 hover:bg-(--color-accent-hover) active:scale-95 disabled:cursor-not-allowed disabled:opacity-50";

export const buttonSecondary =
  "rounded-lg border border-(--color-border-subtle) bg-(--color-bg-hover) px-4 py-2 text-sm font-medium text-(--color-text-primary) transition-all duration-150 hover:border-(--color-border-strong) active:scale-95 disabled:cursor-not-allowed disabled:opacity-50";

export const buttonGhost =
  "rounded-lg px-4 py-2 text-sm font-medium text-(--color-text-secondary) transition-colors duration-150 hover:bg-(--color-bg-hover) hover:text-(--color-text-primary) active:scale-95 disabled:cursor-not-allowed disabled:opacity-50";
