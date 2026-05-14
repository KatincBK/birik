-- 014: Yatırım girişlerinde formül/işlem metnini sakla.
--
-- Kullanıcı tutar alanına "300+150-200" gibi bir işlem yazabiliyor.
-- `amount` hesaplanmış sonucu tutar; `amount_expr` ise kullanıcının yazdığı
-- ham ifadeyi saklar — böylece kaydı tekrar açtığında işlemi olduğu gibi
-- görüp düzenleyebilir (Excel hücresi mantığı). Düz sayı girildiyse NULL.

ALTER TABLE investment_entries ADD COLUMN amount_expr TEXT;
