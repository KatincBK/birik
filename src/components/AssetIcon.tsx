import { useState } from "react";
import { assetTypeColor } from "../lib/colors";

type Props = {
  symbol: string;
  iconUrl: string | null;
  type: string;
  size?: number;
};

/**
 * Varlık logosu — iconUrl varsa onu yükler, yüklenmezse sembol baş harfleriyle
 * fallback. Kripto için CoinGecko URL'i AddAssetModal'da DB'ye yazılıyor.
 * Hisse için Clearbit gibi bir tahminle olabilir (best-effort), gerisi fallback.
 */
export function AssetIcon({ symbol, iconUrl, type, size = 32 }: Props) {
  const [errored, setErrored] = useState(false);
  const color = assetTypeColor(type);
  const px = `${size}px`;
  const fallback = (
    <div
      className="grid shrink-0 place-items-center rounded-full font-semibold tabular"
      style={{
        width: px,
        height: px,
        background: `${color}1F`,
        color,
        fontSize: size <= 24 ? 10 : size <= 32 ? 11 : 13,
      }}
      aria-hidden="true"
    >
      {symbol.slice(0, 3)}
    </div>
  );

  if (!iconUrl || errored) return fallback;

  return (
    <img
      src={iconUrl}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-full bg-(--color-bg-base) object-cover"
      style={{ width: px, height: px }}
      onError={() => setErrored(true)}
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  );
}
