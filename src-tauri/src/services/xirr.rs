//! XIRR — düzensiz tarihli nakit akışları için yıllık para-ağırlıklı getiri.
//!
//! Her para girişi/çıkışı kendi tarihinden sayılır; "varlık − yatırım / yıl"
//! gibi naif bir bölme YAPILMAZ. NPV'yi sıfır yapan yıllık oranı bisection ile
//! çözer (sağlam, çözüm aralığında tek kök varsa garantili).

const YEAR_SECS: f64 = 365.25 * 24.0 * 3600.0;

/// `flows`: (unix saniye tarih, tutar). Yatırım/giriş **negatif**, satış/çıkış
/// ve bugünkü portföy değeri **pozitif**. Hepsi tek para biriminde olmalı.
///
/// Dönüş: yıllık oran (0.12 = %12). Çözüm yoksa, geçmiş çok kısaysa (~18 gün)
/// veya akışlar tek yönlüyse `None`.
pub fn xirr(flows: &[(i64, f64)]) -> Option<f64> {
    if flows.len() < 2 {
        return None;
    }
    // En az bir giriş ve bir çıkış olmalı — yoksa getiri tanımsız.
    let has_neg = flows.iter().any(|(_, a)| *a < 0.0);
    let has_pos = flows.iter().any(|(_, a)| *a > 0.0);
    if !has_neg || !has_pos {
        return None;
    }
    let t0 = flows.iter().map(|(d, _)| *d).min()?;
    let t_max = flows.iter().map(|(d, _)| *d).max()?;
    // Çok kısa geçmiş → yıllıklaştırma anlamsız.
    if (t_max - t0) as f64 / YEAR_SECS < 0.05 {
        return None;
    }

    // Verilen oran için net bugünkü değer (t0'a göre, yıl cinsinden).
    let npv = |rate: f64| -> f64 {
        flows
            .iter()
            .map(|(d, a)| {
                let t = (*d - t0) as f64 / YEAR_SECS;
                a / (1.0 + rate).powf(t)
            })
            .sum()
    };

    // Bisection — [-0.9999, 100.0] aralığında işaret değişimi ara.
    // (1+rate) > 0 kalsın diye alt sınır -0.9999.
    let mut lo = -0.9999_f64;
    let mut hi = 100.0_f64;
    let mut f_lo = npv(lo);
    let f_hi = npv(hi);
    if !f_lo.is_finite() || !f_hi.is_finite() || f_lo * f_hi > 0.0 {
        return None; // aralıkta tek kök yok (örn. toplam kayıp)
    }
    for _ in 0..120 {
        let mid = (lo + hi) / 2.0;
        let f_mid = npv(mid);
        if f_mid.abs() < 1e-6 {
            return Some(mid);
        }
        if f_lo * f_mid < 0.0 {
            hi = mid;
        } else {
            lo = mid;
            f_lo = f_mid;
        }
    }
    Some((lo + hi) / 2.0)
}
