import { AlertTriangle } from "lucide-react";
import { ModalShell, buttonGhost, buttonPrimary, buttonSecondary } from "./Modal";
import { useUIStore } from "../stores/uiStore";
import { formatNumber } from "../lib/format";
import type { SaleValidation } from "../lib/api";

/**
 * PLAN §5: Satış validasyon diyaloğu (3 seçenek).
 *
 *   "5 BTC satmaya çalışıyorsun ama elinde 3 BTC görünüyor.
 *    Eksik 2 BTC nereden geldi?"
 *      [İptal]  [Eksi pozisyona geç (-2 BTC)]  [Hepsini sattım (3 BTC)]
 *
 * onChooseAdjusted: kullanıcı bakiyeye eşitledi, miktar=current_balance ile devam.
 * onChooseShort:    kullanıcı eksi pozisyon kabul etti, miktar değişmez.
 */
export function SaleValidationModal({
  validation,
  symbol,
  onChooseAdjusted,
  onChooseShort,
}: {
  validation: SaleValidation;
  symbol: string;
  onChooseAdjusted: () => void;
  onChooseShort: () => void;
}) {
  const closeModal = useUIStore((s) => s.closeModal);
  const attempted = formatNumber(validation.attempted_quantity, "detail");
  const balance = formatNumber(Math.max(validation.current_balance, 0), "detail");
  const short = formatNumber(validation.shortage, "detail");

  return (
    <ModalShell
      title="Yetersiz bakiye"
      description={`${attempted} ${symbol} satmaya çalışıyorsun ama elinde ${balance} ${symbol} görünüyor. Eksik ${short} ${symbol} nereden geldi?`}
    >
      <div className="flex items-start gap-3 rounded-lg border border-(--color-warning)/30 bg-(--color-warning)/10 px-3 py-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-(--color-warning)" />
        <p className="text-xs text-(--color-text-secondary)">
          Yanlış miktar girdiysen bakiyeye eşitle. Bilerek açığa düşmek
          istiyorsan eksi pozisyon kaydı oluşturulur.
        </p>
      </div>

      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button onClick={closeModal} className={buttonGhost}>
          İptal
        </button>
        <button
          onClick={() => {
            onChooseShort();
            closeModal();
          }}
          className={buttonSecondary}
        >
          Eksi pozisyona geç (-{short} {symbol})
        </button>
        <button
          onClick={() => {
            onChooseAdjusted();
            closeModal();
          }}
          className={buttonPrimary}
        >
          Hepsini sattım ({balance} {symbol})
        </button>
      </div>
    </ModalShell>
  );
}
