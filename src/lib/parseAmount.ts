/**
 * Akıllı sayı parser — Excel/Google Sheets paste senaryolarına dayanıklı.
 *
 * Desteklediği formatlar:
 *   "2131"           → 2131
 *   "2.13"           → 2.13     (US ondalık)
 *   "2,13"           → 2.13     (TR ondalık)
 *   "2.131,56"       → 2131.56  (TR binlik + ondalık)
 *   "2,131.56"       → 2131.56  (US binlik + ondalık)
 *   "$-2.131,56"     → -2131.56 (Excel TR para birimi)
 *   "₺ 5.000,00"     → 5000     (TR liras)
 *   "-100"           → -100
 *   "(100)"          → -100     (muhasebe negatif notasyonu)
 *   "2.000.000"      → 2000000  (çoklu binlik)
 *
 * Belirsiz tek-ayraç durumunda heuristic:
 *   "2.131" → 2131 (3 hane → binlik)
 *   "2.13"  → 2.13 (2 hane → ondalık)
 *
 * @returns Geçerli sayıysa number, aksi halde null (boş, sadece sembol vb.)
 */
export function parseAmount(raw: string): number | null {
  if (typeof raw !== "string") return null;

  let s = raw.trim();
  if (s === "") return null;

  // Formül modu — operatör varsa (leading +/- hariç): tüm virgülleri nokta'ya
  // çevirip basit aritmetik eval. Sadece [0-9.+\-*/()] karakterlere izin verilir
  // (sanitize), Function constructor güvenli.
  const withoutLeadingSign = s.replace(/^[-+]/, "");
  if (/[+\-*/]/.test(withoutLeadingSign)) {
    const expr = s
      .replace(/[$€£₺¥₿\s]/g, "")
      .replace(/[a-zA-Z]/g, "")
      .replace(/,/g, ".");
    if (/^[\d.+\-*/()]+$/.test(expr) && expr.length > 0) {
      try {
        // eslint-disable-next-line no-new-func
        const result = new Function(`"use strict"; return (${expr});`)();
        if (typeof result === "number" && Number.isFinite(result)) {
          return result;
        }
      } catch {
        // formül geçersiz → düşük normal parse'a devam
      }
    }
  }

  // Muhasebe parantez negatif: (100) → -100
  let negativeFromParens = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negativeFromParens = true;
    s = s.slice(1, -1);
  }

  // Para sembolleri, harfler, boşluklar — temizle
  // (USD, TRY, EUR gibi 3-harf kodları + $ ₺ € £ ¥)
  s = s
    .replace(/\s/g, "")
    .replace(/[$€£₺¥₿]/g, "")
    .replace(/[a-zA-Z]/g, "");

  if (s === "" || s === "-" || s === "+") return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");

  let normalized: string;

  if (lastComma === -1 && lastDot === -1) {
    normalized = s;
  } else if (lastComma >= 0 && lastDot >= 0) {
    // İkisi de var → son geleni ondalık ayracı, öncekiler binlik
    const decimalIdx = Math.max(lastComma, lastDot);
    const intPart = s.slice(0, decimalIdx).replace(/[.,]/g, "");
    const fracPart = s.slice(decimalIdx + 1);
    normalized = `${intPart}.${fracPart}`;
  } else {
    // Tek tip ayraç var
    const sep = lastComma >= 0 ? "," : ".";
    const idx = lastComma >= 0 ? lastComma : lastDot;
    const after = s.length - idx - 1;
    const occurrences = s.split(sep).length - 1;

    if (occurrences > 1) {
      // Birden fazla aynı ayraç → hepsi binlik
      normalized = s.split(sep).join("");
    } else if (after === 3) {
      // Tek ayraç, 3 hane sonra → büyük olasılıkla binlik (heuristic)
      normalized = s.split(sep).join("");
    } else {
      // Tek ayraç, 1-2 hane sonra → ondalık
      normalized = s.replace(sep, ".");
    }
  }

  const n = parseFloat(normalized);
  if (!Number.isFinite(n)) return null;
  return negativeFromParens ? -n : n;
}

/**
 * Girdi bir aritmetik işlem mi? (baştaki +/- işareti hariç bir operatör
 * içeriyorsa). `parseAmount`'un formül modu ile aynı kriter — formülü ham
 * haliyle saklamak isteyen yerler bununla karar verir.
 */
export function isAmountFormula(raw: string): boolean {
  if (typeof raw !== "string") return false;
  return /[+\-*/]/.test(raw.trim().replace(/^[-+]/, ""));
}
