-- 015: Eski budgets.monthly_income / monthly_expense alanlarını yeni
-- budget_lines tablosuna kopyala. Migration 013 budget_lines'ı oluşturdu ama
-- mevcut budget'lardaki eski flat değerleri taşımadı — kullanıcı bütçesinde
-- gelir/gider girmiş olsa bile rapor planı boş çıkıyordu.
--
-- Her iki INSERT idempotent: aynı kind için zaten line varsa atlar.
-- start_ym = bu ay, end_ym = NULL (açık uçlu). Kullanıcı sonra Budget
-- sayfasından satır ekleyip/düzenleyip ince ayar yapabilir.

INSERT INTO budget_lines (budget_id, kind, label, amount, currency, start_ym, end_ym, created_at)
SELECT b.id, 'income', 'Aylık gelir', b.monthly_income, b.currency,
       strftime('%Y-%m', 'now'), NULL,
       CAST(strftime('%s', 'now') AS INTEGER)
FROM budgets b
WHERE b.monthly_income > 0
  AND NOT EXISTS (
    SELECT 1 FROM budget_lines bl
    WHERE bl.budget_id = b.id AND bl.kind = 'income'
  );

INSERT INTO budget_lines (budget_id, kind, label, amount, currency, start_ym, end_ym, created_at)
SELECT b.id, 'expense', 'Aylık gider', b.monthly_expense, b.currency,
       strftime('%Y-%m', 'now'), NULL,
       CAST(strftime('%s', 'now') AS INTEGER)
FROM budgets b
WHERE b.monthly_expense > 0
  AND NOT EXISTS (
    SELECT 1 FROM budget_lines bl
    WHERE bl.budget_id = b.id AND bl.kind = 'expense'
  );
