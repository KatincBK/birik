# Portföy Takip App — Geliştirme Brief'i (Agent için)

> Bu dosya bir geliştirme brief'idir. Agent her fazı bitirip kullanıcıya checkpoint sunar, onay aldıktan sonra bir sonraki faza geçer. Her fazın sonunda **Acceptance Criteria** vardır — bunlar tamamlanmadan faz biter sayılmaz.

---

# 1. Proje Özeti

**Ne yapıyoruz?** Kişisel kullanım için, yüksek "game feel" hissi veren bir desktop portföy takip uygulaması. Kullanıcı kripto, ABD hisseleri, döviz ve altın varlıklarını takip eder, işlem geçmişini girer, kar-zararını izler, fiyat alarmları kurar, yatırım hedefleri belirler.

**Kim kullanacak?** Şimdilik sadece geliştirici. İleride dağıtılabilir.

**Platform:** Windows (öncelik). Mac/Linux sonraya bırakıldı.

**Felsefe:** Her aksiyon hissedilmeli. Sayılar canlanmalı. Sessiz bir Excel değil, oynanan bir oyun gibi olmalı — ama abartısız, "Apple Pay benzeri" zarafet seviyesinde.

---

# 2. Teknoloji Stack'i

| Katman | Tercih | Versiyon notu |
|---|---|---|
| Framework | Tauri | **2.x** (1.x değil — API'ler farklı) |
| Frontend | React + TypeScript + Vite | Son stable |
| Styling | Tailwind CSS | v4 |
| Database | SQLite | `tauri-plugin-sql` |
| Charts | Recharts | — |
| Animation | Framer Motion | — |
| Toast | Sonner | — |
| State | Zustand | — |
| OS Notification | `tauri-plugin-notification` | — |
| Updater altyapısı | `tauri-plugin-updater` | Şimdiden kur, paylaşıma hazır olsun |

**Yapma:**
- yfinance (Python'a özel)
- Tauri 1.x
- API key'leri frontend'e bundle etme — `tauri-plugin-store` veya OS keychain üzerinden
- Spinner — yerine skeleton screens
- Light mode kodu

---

# 3. Veri Kaynakları

| Varlık tipi | Kaynak | Detay |
|---|---|---|
| Kripto | CoinGecko | Key'siz, 30 req/dk, 5 dk cache ile sorun yok |
| ABD hisseleri | Yahoo Finance (resmi olmayan) | Key'siz, `query1.finance.yahoo.com` |
| Döviz | TCMB XML | `today.xml` günlük, 15:30 güncellenir |
| Altın | TCMB veya goldapi.io | Agent karar verir, gram altın TRY için XAU+USD/TRY hesabı yapılabilir |

**İleride (TODO not):** Yahoo bozulursa Stooq.com CSV fallback olarak eklenebilir (gün sonu kapanış, key'siz). Şimdilik sadece Yahoo.

**Cache:** SQLite `price_cache` tablosu, 5 dk TTL, varlık başına satır.

**Endpoint'ler:**
- `https://api.coingecko.com/api/v3/simple/price?ids={id}&vs_currencies=usd,try,eur`
- `https://api.coingecko.com/api/v3/search?query={q}`
- `https://query1.finance.yahoo.com/v8/finance/chart/{symbol}`
- `https://query2.finance.yahoo.com/v1/finance/search?q={q}`
- `https://www.tcmb.gov.tr/kurlar/today.xml`

---

# 4. Design System

## 4.1 Renk Paleti (Dark Mode Only)

```
Background base    #0A0A0B   (en arka plan)
Background panel   #131316   (kartlar, modal arka planı)
Background hover   #1C1C21   (hover state)
Border subtle      #2A2A30   (ayraç çizgileri)
Border strong      #3A3A42   (input border)

Text primary       #F5F5F7   (başlıklar, ana metin)
Text secondary     #A1A1AA   (ikincil metin, label)
Text tertiary      #6B6B75   (ipuçları, placeholder)

Accent (brand)     #FF8B7A   (somon/coral — buton, link, vurgu)
Accent hover       #FFA08F   (biraz daha açık)
Accent muted       #FF8B7A / 18% opacity (background için, hafif glow)
Accent deep        #E5705F   (active/pressed state)

Success (kar)      #10B981   (yeşil)
Success bg         #10B981 / 15% opacity
Danger (zarar)     #DC2626   (saf kırmızı — somon accent ile karışmaması için biraz daha derin)
Danger bg          #DC2626 / 15% opacity
Warning            #F59E0B   (uyarılar, alarm)
```

**Önemli not (renk disiplini):** Somon accent **brand** rengidir (CTA, link, vurgu, focus ring). Zarar kırmızısı **fonksiyonel** renktir (sadece negatif değerler). İkisinin karışmaması için somon biraz turuncuya kayan, zarar saf kırmızı tutuldu. Aynı ekranda kar-zarar göstergesinde somon kullanma — confusing olur.

## 4.2 Tipografi

- **Font:** Inter (Google Fonts) veya Geist (npm: `geist`)
- **Sayılar için kritik:** `tabular-nums` Tailwind class'ı her yerde — fiyat değişince rakam genişliği zıplamasın
- **Hiyerarşi:**
  - Display (toplam değer): 48-64px, weight 600, tracking -0.02em
  - H1: 32px, weight 600
  - H2: 24px, weight 600
  - Body: 14-15px, weight 400
  - Small/label: 12px, weight 500, uppercase, tracking 0.05em, secondary text rengi

## 4.3 Spacing & Shape

- Tailwind default scale (4px temel)
- Kart border-radius: 12px (`rounded-xl`)
- Buton border-radius: 8px (`rounded-lg`)
- Modal border-radius: 16px (`rounded-2xl`)
- Shadow: çok hafif, koyu (`shadow-2xl shadow-black/40`) — dark theme'de glow daha çok kullan

## 4.4 Animation Timing

```
Hızlı (hover, button press):     150ms ease-out
Standart (modal, sheet):         250ms cubic-bezier(0.16, 1, 0.3, 1)
Yavaş (sayı animasyonu):         400ms cubic-bezier(0.16, 1, 0.3, 1)
Çok yavaş (page transition):     500ms
Celebration (hedefe ulaşma):     800-1200ms multi-stage
```

Easing tercihi: `cubic-bezier(0.16, 1, 0.3, 1)` — "smooth out" hissi, Apple'ın sevdiği eğri.

---

# 5. Vibe & İçerik (Tone of Voice)

App'in karakteri:
- **Sakin ama canlı.** Mali bir araç, abartılı emoji ve agresif ünlemler kullanılmaz. Ama statik de değil — sayılar nefes alır.
- **Kullanıcı dili Türkçe.** UI metinleri Türkçe. Dil sade, samimi ama saygılı.
- **Mizah ölçülü.** Boş ekranda "Henüz hiçbir şey yok" yerine "İlk varlığını ekleyince burası canlanacak" gibi.
- **Finansal terimleri açıkla, gizleme.** "Ortalama Maliyet" yazınca yanına `(?)` ile küçük bir tooltip — "Toplam alış maliyeti / mevcut adet" açıklaması.

## Hazır Metin Kütüphanesi (i18n için tek yerde tut)

**Empty states:**
- Dashboard boş: "İlk varlığını ekle, dashboard hayata gelsin"
- İşlem yok: "Bu varlık için henüz işlem girilmedi"
- Alarm yok: "Henüz fiyat alarmı yok. Bir varlığa eşik koy, fiyat oraya gelince haber verelim."
- Hedef yok: "İlk yatırım hedefini belirle. Yola çıktığında daha güzel."

**Başarı mesajları:**
- İşlem eklendi: "İşlem kaydedildi"
- İşlem silindi: "İşlem silindi" + Geri Al butonu (5sn)
- Alarm kuruldu: "Alarm hazır. Fiyat eşiği geçince haber alacaksın."
- Hedef kuruldu: "Hedef belirlendi. Şimdi yola çıkma vakti."

**Hata mesajları:**
- API down: "Şu an fiyat verisine ulaşamıyoruz. Birazdan tekrar deneyeceğiz."
- Network yok: "İnternet bağlantısı yok gibi görünüyor"
- Validation: Spesifik ol — "Miktar 0'dan büyük olmalı", "Tarih bugünden ileri olamaz"

**Onay diyalogları:**
- Silme: "Bu işlemi silmek istediğine emin misin? Geri alınamaz."
- Reset: "Tüm veriler silinecek. Önce yedek almak ister misin?"

**Uyarılar (sale validation):**
- "5 BTC satmaya çalışıyorsun ama elinde 3 BTC görünüyor. Eksik 2 BTC nereden geldi?"
  - "İptal" / "Hepsini sattım (3 BTC)" / "Eksi pozisyona geç (-2 BTC)"

---

# 6. Feedback Sistemi (DETAYLI)

> Bu bölüm app'in karakterini belirler. Agent burayı titizlikle uygulamalı.

## 6.1 Feedback Eventleri Kataloğu

### A) İşlem Ekleme — Başarılı
1. Form submit → buton scale-95'e iner (150ms)
2. Buton "Kaydediliyor..." metni + skeleton pulse (sadece çok yavaş ise — optimistic update yüzünden genelde görünmez)
3. Optimistic update: işlem hemen tabloya düşer, opacity 0.6'dan 1'e geçer (300ms)
4. Modal kapanır (slide down + fade out, 250ms)
5. Sonner toast belirir: "İşlem kaydedildi" — yeşil sol border, check ikonu (Lucide `Check`)
6. Dashboard toplam değeri animate edilir (count-up, 400ms)
7. Etkilenen varlık satırı 600ms boyunca yeşil pulse
8. Ses: hafif "ding" (kullanıcı sesleri açtıysa, default açık)
9. Confetti: 3 saniyelik **küçük** confetti burst (sadece ilk işlemse veya hedefe yaklaşıyorsa, abartı olmasın)

### B) İşlem Silme
1. Silme butonu → confirmation tooltip (small, 2 buton)
2. Onaylanırsa: satır kırmızı pulse → kayar ve siler (300ms)
3. Toast: "İşlem silindi" + **Geri Al** butonu, 5 saniye görünür
4. Geri Al tıklanırsa: satır geri gelir, yeşil pulse
5. Ses: hafif "swoosh"

### C) Fiyat Refresh
1. Refresh butonu döner (rotate 360deg, 800ms)
2. Etkilenen tüm satırlarda fiyat hücresi shimmer skeleton'a döner (sadece o hücre)
3. Yeni fiyat gelir → eski fiyattan yeni fiyata count animasyonu (400ms)
4. Fiyat yükselişse hücre yeşil flash (300ms), düşüşse kırmızı
5. Yan tarafta küçük ▲/▼ ikonu yön gösterir
6. Ses: yok (çok sık gerçekleşir, rahatsız eder)

### D) Currency Toggle (Click-to-cycle)
1. Toplam değere hover → cursor pointer, hafif underline
2. Tıklanır → sayı flip animasyonu: eski değer Y ekseninde 90° döner kaybolur (200ms), yeni değer 90°'den geri açılır (200ms)
3. Para birimi sembolü/kodu da değişir (sayının yanında)
4. Ses: hafif "tick"

### E) Hedefe Ulaşma (Special)
1. Hedef değere ulaşıldığı andan 200ms sonra:
2. Tüm ekran karartılır (overlay, 50% siyah, 300ms)
3. Ortada büyük badge belirir: "HEDEF! 🎯" (scale 0'dan 1.2'ye, sonra 1'e — bounce)
4. Hedef adı + ulaşılan değer altta küçük metin
5. Confetti — bu sefer abartılı, full ekran
6. Ses: "achievement" — kısa ama tatmin edici (FF7 victory benzeri ama kısa)
7. 3 saniye sonra overlay yumuşakça kaybolur, "Yeni hedef belirle" CTA'sı çıkar
8. Bu event log'a yazılır, settings'ten "celebration history" görünür

### F) Fiyat Alarmı Tetiklendi
1. OS notification gönderilir (Tauri notification): "BTC $80,000 eşiğini geçti"
2. App açıksa ek olarak: ilgili varlık satırı 5 saniye yumuşak yellow glow
3. App üst barında küçük zil ikonu pulse, alarm sayısı badge ile
4. Ses: OS default notification sesi (Tauri'nin kendi handle ettiği)

### G) Hata
1. Etkilenen alan/buton kırmızı border (300ms)
2. Hafif horizontal shake (translateX -4 → 4 → -2 → 0, 250ms toplam)
3. Toast (kırmızı): hata mesajı
4. Ses: kısa "error" tonu (hafif, sinir bozucu olmamalı)

### H) Loading States
- Spinner YOK
- Skeleton screens — varlık kartı, tablo satırı, chart placeholder hepsinin kendi skeleton'u
- Skeleton'lar shimmer animasyonu (Tailwind: `animate-pulse` yerine custom shimmer keyframe)
- İlk açılışta optimistic — DB'den okuma instant, fiyat fetch background'da

## 6.2 Optimistic Update Kuralı

Her async aksiyonda:
1. UI hemen güncellenir (yeni state'e geçer, yarı opaklık veya "saving" indikatörü ile)
2. Backend'e istek gider
3. Başarılı → opaklık tam, tüm animasyonlar tetiklenir
4. Başarısız → UI eski state'e döner, hata toast'u, kullanıcı tekrar deneyebilir

İstisnalar:
- Silme işleminde optimistic update KULLANILIR ama 5sn undo penceresi içinde DB'ye gerçek silme atılmaz, sadece "isDeleted" flag set edilir
- 5sn dolarsa gerçek silme

## 6.3 Sesler (Implementation)

- Web Audio API ile mp3/ogg yükle
- 4-5 kısa ses dosyası: ding, swoosh, click, error, achievement
- `src/assets/sounds/` altında
- Settings'te toggle (Zustand'da `soundEnabled` state)
- Volume default %30

---

# 7. Para Birimi & Sayı Formatları

## 7.1 Currency Toggle
- Varsayılan: USD
- Click-to-cycle: kullanıcı settings'ten hangi birimlerin döngüde olacağını seçer (USD, TRY, EUR, BTC, ETH... checkbox)
- Toplam değer kullanıcının seçtiği birimde gösterilir, son seçilen birim hatırlanır

## 7.2 Sayı Formatları

**Özet/dashboard (yuvarlanmış, okunaklı):**
- $12,400 (binlik virgül, kuruş yok)
- $1.24M (1.000.000+ için kısaltma)
- 0.024 BTC (kripto bakiye)
- $12.4K (10.000+ için kısaltma — opsiyonel toggle)

**Detay sayfası (tam hassasiyet):**
- $12,432.87 (kuruş açık)
- 0.02347182 BTC (8 ondalık)
- 1,234.56789 ETH (anlamlı haneye kadar)

**Smart format kuralı:**
- 0 < x < 1: anlamlı 4 hane (0.0000234)
- 1 ≤ x < 1000: 2 ondalık
- x ≥ 1000: virgüllü, 2 ondalık (özet) veya tam (detay)

## 7.3 Pozitif/Negatif Vurgu
- Kar: yeşil (`success`), önünde `+` işareti, ▲ ikon opsiyonel
- Zarar: kırmızı (`danger`), önünde `-` işareti, ▼ ikon opsiyonel
- Sıfır/değişim yok: secondary text rengi, sembol yok

---

# 8. Ekran/Sayfa Yapısı

> Layout pixel-perfect verilmedi — agent kendi tasarım kararlarını verebilir, ama bileşenler ve davranışlar şu şekilde:

## 8.1 Ana Layout
- **Sol sidebar (sabit):** Logo, portföy listesi (seçilebilir), "Hepsi" konsolide görünüm, alt kısımda settings/help linki
- **Üst bar:** Aktif portföy adı, son refresh zamanı, manuel refresh butonu, Ctrl+K ipucu
- **Ana panel:** Aktif sayfaya göre değişir

## 8.2 Sayfalar

### Dashboard
- **Hero:** Toplam portföy değeri (büyük, click-to-cycle currency)
- Altında: günlük değişim (+/- ve %), son 24s/7g/30g toggle
- **Pie chart:** Varlık dağılımı (kripto vs hisse vs döviz vs altın)
- **Liste:** Tüm varlıklar tablosu (sembol, miktar, ortalama maliyet, güncel fiyat, kar-zarar, % değişim)
- **Hedefler kartı (varsa):** En yakın hedef + progress bar
- **Pasif gelir kartı (varsa):** Bu ay toplam pasif gelir + kaynak breakdown

### Varlık Detay
- **Hero:** Varlık ikonu, sembol, isim, güncel fiyat (animate)
- Mevcut pozisyon kartı: miktar (tam hassasiyet), ortalama maliyet, toplam değer, kar-zarar
- İşlem geçmişi tablosu (tarih, tip, miktar, fiyat, ücret, not, etiketler)
- Yeni işlem ekle butonu

### Yeni Varlık Ekleme (Modal)
- Üstte: varlık tipi seçici (kripto / hisse / döviz / altın)
- Altta: dropdown autocomplete arama (yazıya göre canlı sonuç)
- Sonuç tıklanınca varlık seçilir, "İlk işlemi gir" formuna geçer (opsiyonel)

### Yeni İşlem (Modal)
- Tarih seçici (default: bugün)
- Tip: Alış / Satış / Pasif Gelir (radio)
- Pasif Gelir seçilirse alt seçim: Staking / Temettü / Faiz
- Miktar input
- Fiyat input (kripto/hisse için, varsayılan güncel fiyat)
- Ücret input (opsiyonel)
- Not (opsiyonel)
- Etiketler (chip input — `#uzun-vade` gibi)
- Submit → satış validasyon devreye girebilir

### Pasif Gelir Paneli
- Kaynak breakdown (pie veya stacked bar): staking vs dividend vs interest
- Aylık trend
- Gelir kaydı listesi (tarih, varlık, kaynak, miktar, USD değeri)

### Alarmlar
- Aktif alarmlar listesi (varlık, eşik, koşul: > / <)
- Tetiklenmiş alarm geçmişi
- Yeni alarm butonu

### Hedefler
- Aktif hedefler kartları (her biri progress bar ile)
- Tahmini ulaşma süresi
- Yeni hedef ekleme

### Settings
- Para birimi: varsayılan + döngüye dahil olanlar (multi-select)
- Sesler: on/off
- Refresh interval: 1 / 5 / 15 dk
- Yedekleme: otomatik on/off, manuel export, manuel import
- Veri kaynakları: Yahoo (varsayılan, gri), [TODO note: Stooq fallback ileride]

---

# 9. Veri Modeli (SQLite)

```sql
-- Versiyonlu migrations şart

CREATE TABLE portfolios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL  -- unix timestamp
);

CREATE TABLE assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  portfolio_id INTEGER NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,           -- BTC, AAPL, USD, XAU
  name TEXT NOT NULL,             -- Bitcoin, Apple Inc.
  type TEXT NOT NULL,             -- 'crypto' | 'stock' | 'fx' | 'commodity'
  currency TEXT NOT NULL,         -- USD, TRY (varlığın işlem gördüğü para birimi)
  external_id TEXT,               -- coingecko id (bitcoin), yahoo symbol (AAPL)
  created_at INTEGER NOT NULL,
  UNIQUE(portfolio_id, symbol)
);

CREATE TABLE transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  date INTEGER NOT NULL,          -- unix timestamp
  type TEXT NOT NULL,             -- 'buy' | 'sell' | 'passive_income'
  source TEXT,                    -- 'staking' | 'dividend' | 'interest' (passive_income için)
  quantity REAL NOT NULL,
  price REAL NOT NULL,            -- birim fiyat
  fee REAL DEFAULT 0,
  note TEXT,
  is_deleted INTEGER DEFAULT 0,   -- soft delete (5sn undo için)
  created_at INTEGER NOT NULL
);

CREATE TABLE transaction_tags (
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (transaction_id, tag)
);

CREATE TABLE price_cache (
  asset_id INTEGER PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
  price REAL NOT NULL,
  currency TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE price_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  condition TEXT NOT NULL,        -- 'above' | 'below'
  threshold REAL NOT NULL,
  currency TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  triggered_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  target_value REAL NOT NULL,
  currency TEXT NOT NULL,
  target_date INTEGER,            -- nullable
  achieved_at INTEGER,             -- nullable
  created_at INTEGER NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Default settings
INSERT INTO settings VALUES
  ('display_currency', 'USD'),
  ('currency_cycle', '["USD","TRY","EUR"]'),
  ('sound_enabled', 'true'),
  ('refresh_interval_min', '5'),
  ('auto_backup', 'true');
```

---

# 10. Backend Komutları (Rust)

Tüm komutlar `#[tauri::command]` ile expose edilir, frontend `invoke()` ile çağırır.

```
// Veri çekme
fetch_crypto_price(coingecko_id: String) -> PriceResult
fetch_stock_price_yahoo(symbol: String) -> PriceResult
fetch_fx_rates() -> HashMap<String, f64>  // TCMB'den hepsi
search_symbol(query: String, asset_type: String) -> Vec<SearchResult>

// Cache
get_cached_price(asset_id: i64) -> Option<CachedPrice>
refresh_all_prices(portfolio_id: i64) -> Result

// CRUD
create_portfolio(name: String) -> Portfolio
list_portfolios() -> Vec<Portfolio>
delete_portfolio(id: i64) -> Result

create_asset(portfolio_id, symbol, name, type, currency, external_id) -> Asset
list_assets(portfolio_id: i64) -> Vec<Asset>
delete_asset(id: i64) -> Result

create_transaction(...) -> Transaction
list_transactions(asset_id: i64) -> Vec<Transaction>
soft_delete_transaction(id: i64) -> Result
hard_delete_transaction(id: i64) -> Result  // 5sn sonra çağrılır
restore_transaction(id: i64) -> Result      // undo

// İş mantığı
validate_sale(asset_id: i64, quantity: f64) -> SaleValidation
  // returns: { current_balance, is_sufficient, suggested_max }

calculate_portfolio(portfolio_id: i64, display_currency: String) -> PortfolioStats
  // toplam değer, günlük değişim, varlık başına kar-zarar

calculate_passive_income(portfolio_id: i64, period: String) -> PassiveIncomeStats
  // breakdown by source (staking/dividend/interest)

// Alarm & hedefler
create_alert(...), list_alerts(), delete_alert(...)
create_goal(...), list_goals(), check_goal_achievement(goal_id) -> bool

// Yedekleme
export_data() -> String  // JSON
import_data(json: String, mode: String) -> Result  // mode: replace | merge
trigger_backup() -> Result  // manuel

// Settings
get_setting(key: String) -> Option<String>
set_setting(key: String, value: String) -> Result
```

---

# 11. Edge Case Kataloğu

| Durum | Beklenen davranış |
|---|---|
| Network yok | Cache'den göster, üst barda "Çevrimdışı" rozeti, refresh denemeleri exponential backoff ile |
| API down (Yahoo 500 dönüyor) | Cache son değer, "Veri kaynağına ulaşılamıyor" warning toast |
| Sembol bulunamadı | Search'te "Aradığın sembol bulunamadı" + "Manuel ekle" butonu (kullanıcı kendi yazsın) |
| Varlık silinince | Bağlı tüm transaction/alert cascade silinir (DB constraint), kullanıcıya "X işlem ve Y alarm da silinecek" uyarısı |
| Portföy silme | "Hepsi" görünümünden de düşer, son portföyse silmeye izin verme |
| Aynı sembol farklı portföyde | İzin var (kullanıcı emeklilik ve spekülatifte ayrı tutmak isteyebilir) |
| Negatif bakiye (kullanıcı izin verdi) | Detay sayfasında kırmızı "Short pozisyon: -2 BTC" rozeti |
| Tarih bugünden ileri | Validation hatası: "Gelecek tarihli işlem girilemez" |
| Miktar = 0 | Validation hatası |
| Fiyat = 0 | Pasif gelir için izinli, alış/satış için validation hatası |
| Ondalık ayraç farkı | Input hem `,` hem `.` kabul etsin, internal'de `.` |
| Boş etiket | Submit'te trim, boşsa kaydetme |
| Aynı etiket tekrar | DB'de unique constraint, sessizce ignore |
| Hedef geçmiş tarihli | İzin ver, "Hedefe ulaşma süresi geçmiş" warning |
| İlk açılış | Default "Ana Portföy" oluştur, dashboard boş state göster |
| Migration başarısız | Yedeği yükle, hata logu göster, kullanıcıya rapor et |
| Çok eski cache (>1 saat) | "Fiyatlar eski olabilir" rozet, otomatik refresh tetikle |

---

# 12. Geliştirme Fazları

> **CHECKPOINT KURALI:** Her faz sonunda agent kullanıcıya şu raporu sunar:
> - Bu fazda ne yapıldı (madde madde)
> - Acceptance criteria check (✅/❌)
> - Açık kalan ufak konular
> - Bir sonraki faza geçmek için onay ister
>
> Onay alınmadan bir sonraki faza geçilmez.

## Faz 1 — Kurulum & İskelet
**Hedef:** Boş ama dark theme'li Tauri app'i açılıyor.

Adımlar:
- `npm create tauri-app@latest` (React + TS template, Tauri 2.x)
- Tailwind v4 kurulumu, design system tokens config'e
- Inter veya Geist font yüklemesi
- Plugin'ler: `tauri-plugin-sql`, `tauri-plugin-notification`, `tauri-plugin-updater`
- Klasör yapısı:
  ```
  src/
    components/  (UI bileşenleri)
    hooks/       (custom hooks)
    lib/         (utility fonksiyonları)
    stores/      (Zustand)
    pages/       (sayfa-seviye componentler)
    assets/sounds/
  src-tauri/
    src/
      commands/  (her domain ayrı dosya)
      db/        (migrations, helpers)
      services/  (price fetchers, cache)
  ```
- Zustand store iskeleti (tema, settings)
- Framer Motion + Sonner kurulum
- Boş layout: sol sidebar + üst bar + ana panel (boş)

**Acceptance Criteria:**
- ✅ `npm run tauri dev` ile app açılıyor
- ✅ Dark theme aktif, palette doğru görünüyor
- ✅ Sidebar + top bar + main area iskeleti var
- ✅ Tüm pluginler crash etmeden yükleniyor

## Faz 2 — Veri Modeli
**Hedef:** SQLite schema kurulu, default veriler atılmış.

Adımlar:
- Tüm tablolar (Bölüm 9) migration olarak yazılır
- Migrations versiyonlu olsun (schema_version tablosu)
- `services/db.rs` — connection helper
- Default portfolio "Ana Portföy" yaratılır
- Default settings yazılır

**Acceptance Criteria:**
- ✅ Uygulama ilk açılışta DB dosyasını yaratıyor
- ✅ Default portföy ve settings içerikte
- ✅ Migration ikinci açılışta tekrar çalışmıyor (idempotent)

## Faz 3 — Backend Servisleri
**Hedef:** Fiyat çekme, cache, CRUD komutları çalışıyor (frontend henüz tüketmiyor).

Adımlar:
- CoinGecko, Yahoo, TCMB price fetcher fonksiyonları
- 5 dk TTL cache wrapper
- Bölüm 10'daki tüm Tauri komutları implement
- `validate_sale`, `calculate_portfolio`, `calculate_passive_income` iş mantığı
- Background task: alarm kontrol döngüsü
- Birim test (en azından business logic için: ortalama maliyet hesabı, sale validation)

**Acceptance Criteria:**
- ✅ Tüm `invoke()` komutları frontend'den çağrılınca doğru cevap dönüyor (DevTools console'dan test)
- ✅ CoinGecko'dan BTC fiyatı geliyor
- ✅ Yahoo'dan AAPL fiyatı geliyor
- ✅ TCMB'den USD/TRY geliyor
- ✅ Cache çalışıyor (5 dk içinde tekrar çağrı API'ye gitmiyor — log'la doğrula)
- ✅ Sale validation senaryoları doğru çalışıyor

## Faz 4 — Frontend MVP (Dashboard + Varlık + İşlem)
**Hedef:** Bir varlık ekleyip işlem girip dashboard'da görebilmek.

Adımlar:
- Layout polish (sidebar, top bar)
- Dashboard sayfası: hero (toplam değer), pie chart placeholder, varlık listesi tablo
- "Varlık Ekle" modal: varlık tipi seçici + autocomplete arama (CoinGecko/Yahoo search)
- "İşlem Ekle" modal: form, tarih seçici, miktar/fiyat/ücret input, etiket chip'i
- Satış validasyon modali (3 seçenekli)
- Varlık detay sayfası
- Manuel refresh butonu

**Acceptance Criteria:**
- ✅ "Varlık Ekle" → BTC ara → seç → eklendi
- ✅ "İşlem Ekle" → 0.5 BTC alış @ $60.000 → kaydedildi
- ✅ Dashboard'da toplam değer doğru (0.5 × güncel BTC fiyatı)
- ✅ Kar-zarar doğru hesaplanıyor
- ✅ Varlık detayında işlem listesi görünüyor
- ✅ Sale validation modal'ı: 1 BTC satmaya çalış (elinde 0.5 var), 3 seçenek geliyor
- ✅ Manuel refresh çalışıyor

## Faz 5 — Game Feel Geçişi
**Hedef:** App "yaşıyor" hissi versin.

Adımlar:
- Tüm rakamlar `useCountUp` hook'u ile sarılır (custom yaz veya `react-countup` kullan)
- Buton hover/active mikro animasyonları (Tailwind class'larıyla)
- Kart hover (Framer Motion `whileHover`)
- Modal aç/kapat: AnimatePresence + slide/fade
- Currency toggle flip animasyonu
- Sonner toast'lar (Bölüm 6'daki tüm event'ler için)
- Skeleton screens her async componentte (varlık kartı, tablo satırı, chart)
- Optimistic update pattern her CUD işleminde
- Confetti (canvas-confetti kütüphanesi)
- Ses efektleri (5 ses: ding, swoosh, click, error, achievement) + settings toggle
- Hedefe ulaşma celebration sahnesi
- Renk pulse'ları (kar-zarar değişiminde)

**Acceptance Criteria:**
- ✅ Toplam değere tıklayınca para birimi smooth değişiyor
- ✅ İşlem ekleme: optimistic + toast + sayı animasyonu + ses + opsiyonel confetti
- ✅ İşlem silme: undo butonu 5sn çalışıyor, geri alınca satır geri geliyor
- ✅ Hata durumlarında shake + kırmızı border + toast
- ✅ Hiçbir yerde spinner yok, sadece skeleton
- ✅ Settings'ten ses kapatınca tüm sesler susuyor
- ✅ Test hedefi yarat (mevcut değerden çok az yüksek), refresh et → celebration tetikleniyor

## Faz 6 — Ekstra Özellikler
**Hedef:** Çoklu portföy, pasif gelir, etiketler, alarmlar, hedefler.

Adımlar:
- Sidebar'da portföy yönetimi (ekle, sil, "Hepsi" görünümü)
- "Hepsi" görünümünde portföyler birleştirilmiş gösterilir
- Pasif gelir paneli (yeni sayfa): kaynak breakdown, aylık trend
- "İşlem Ekle"de pasif gelir tipi + kaynak alanı
- Etiketler — chip input, etikete göre filtreleme
- Alarmlar sayfası: liste + ekleme modal'ı
- Background task: 5 dk'da bir alarm kontrolü, tetiklenirse OS notification
- Hedefler sayfası: progress bar (animate), tahmini süre, ekleme modal'ı
- Hedef ulaşma celebration entegrasyonu

**Acceptance Criteria:**
- ✅ Birden fazla portföy yaratılabiliyor, sidebar'da seçilebiliyor
- ✅ "Hepsi" konsolide görünüm doğru toplam veriyor
- ✅ Staking ödülü işlemi girilebiliyor, pasif gelir panelinde görünüyor
- ✅ Etiketle işlem filtreleme çalışıyor
- ✅ Alarm kurulup test edildiğinde OS notification geliyor
- ✅ Hedef ekleyince progress bar mevcut duruma göre doluyor
- ✅ Ulaşılamayan hedef → "X% yolda, ~Y ay kaldı (mevcut tempoyla)"

## Faz 7 — Polish & Yedekleme
**Hedef:** Production-quality kullanılabilir app.

Adımlar:
- Otomatik günlük backup (Rust scheduler, Tauri'nin background task'ı)
- AppData/backups/ klasörüne 7 günlük rotasyonlu yedek
- Settings sayfası tam (currency cycle multi-select, ses, refresh interval, export, import)
- Klavye kısayolları (Ctrl+K, Ctrl+N, Ctrl+R, Esc)
- Onboarding (sadece boş dashboard + "+ Varlık Ekle" CTA, tur yok)
- Error boundary'ler (React)
- Graceful API hata yönetimi (retry, offline indicator)
- Updater altyapısı (signing key, GitHub releases endpoint config)
- README.md (kurulum, kullanım)
- Build script: `npm run tauri build` Windows .msi/.exe üretmeli

**Acceptance Criteria:**
- ✅ Manuel export → JSON dosyası iniyor, içerik doğru
- ✅ Manuel import (replace mode) → veriler değişiyor
- ✅ Manuel import (merge mode) → veriler birleşiyor
- ✅ 7 gün boyunca app açılırsa 7 yedek dosyası birikmiş
- ✅ Settings'te currency cycle değiştirilince toggle davranışı değişiyor
- ✅ Ctrl+K varlık aramayı açıyor
- ✅ İnternet kapalıyken app çöküyor değil, cache'den çalışıyor
- ✅ `npm run tauri build` başarıyla `.msi` üretiyor
- ✅ TODO not: Stooq fallback için kod yorumu eklenmiş

---

# 13. Kritik Hatırlatmalar (Agent için son notlar)

- Her faz sonunda **CHECKPOINT** — kullanıcıya rapor + onay iste
- Tauri 2.x docs: https://v2.tauri.app/
- Currency cycle UX, app'in karakteristik özelliği — özen göster
- Sayılar = duygu. `tabular-nums` ve count-up animasyonu HER yerde
- Spinner = ban edilmiş kelime
- Light mode kodu = ban edilmiş
- API key gerektirme = ban edilmiş (Yahoo + CoinGecko + TCMB key'siz çalışıyor)
- Mizah ölçülü, içerikler Türkçe ve sade
- Ses efektleri tatlı, agresif değil — Apple Pay seviyesi

**MVP hedefi (Faz 4 sonu):** BTC ekle → 0.5 BTC alış gir → dashboard'da toplam değeri gör (USD), tıkla → TRY'ye geçsin. 5 dk sonra fiyat refresh olsun, sayı animate olsun.

---

## Tarihsel Grafik Özelliği (2026-05-10 turu)

### Veri kaynakları (key'siz)

- **Kripto** birincil: Binance Klines `https://api.binance.com/api/v3/klines?symbol={SYM}USDT&interval={5m|15m|1h|4h|1d|1w}&limit={n}`. Yedek: CoinGecko market_chart `https://api.coingecko.com/api/v3/coins/{id}/market_chart?vs_currency=usd&days={1|7|14|30|90|180|365|max}`.
- **Hisse / Emtia (commodity)**: Yahoo Finance chart `https://query1.finance.yahoo.com/v8/finance/chart/{TICKER}?range={1d|5d|1mo|3mo|6mo|1y|2y|5y|max}&interval={5m|15m|1h|1d|1wk}`. Altın için `GC=F` ticker (USD/oz).
- **Döviz (fx)**: Frankfurter range `https://api.frankfurter.dev/{from}..{to}?base=USD&symbols={CCY}`. (Latest endpoint zaten v6 öncesinden mevcut.) TCMB tarihsel için her gün ayrı XML var, pratik değil — Frankfurter yeterli.

### Schema (migration 008)

```sql
CREATE TABLE price_history (
  asset_id    INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  range       TEXT NOT NULL,        -- '1d' | '1w' | '1m' | '3m' | '1y' | 'max'
  data        TEXT NOT NULL,        -- JSON: [[timestamp_ms, price], ...]
  fetched_at  INTEGER NOT NULL,
  PRIMARY KEY (asset_id, range)
);
CREATE INDEX idx_price_history_fetched ON price_history(fetched_at);
```

`portfolio_snapshots` (migration 003) korundu (currency-based per-day). Daily job artık her portföy için **iki currency** yazıyor: kullanıcının aktif `display_currency`'si + USD. USD baz currency olarak `fetch_portfolio_history` tüm display currency'lere current FX ile dönüştürür.

### Cache TTL

- `1d` → 5 dk (intraday değişiyor)
- `1w` / `1m` → 1 saat
- `3m` / `1y` / `max` → 24 saat (eski veri sabit, yeni nokta sadece günlük eklenir)

### Backend komutları

- `fetch_asset_history(asset_id, range) -> AssetHistory` — `commands/history.rs`. Cache → fresh fallback chain (Binance → CoinGecko / Yahoo / Frankfurter). Sonuç JSON olarak `price_history` tablosuna yazılır.
- `fetch_portfolio_history(portfolio_id?, range, display_currency) -> PortfolioHistory` — Native currency snapshot varsa direkt; yoksa USD snapshot'larını current FX ile display'e çevirir. `portfolio_id=null` → "Hepsi" (tüm portföyler GROUP BY date).

### Background job

`services/backup::write_portfolio_snapshots` her portföy için `calculate_portfolio_inner`'i hem display_currency'de hem USD'de çağırır → her ikisini de `portfolio_snapshots`'a yazar. Loop: `spawn_daily` 24sa interval. Boot'ta da çalıştırılması (eksik gün backfill) ileri faza atıldı (forward-only MVP).

### UI

**Asset detay sayfası — `PriceChart`**:
- Range chip'leri: 1G / 1H / 1A / 3A / 1Y / Tümü (somon active state)
- AreaChart, somon stroke + gradient (alpha 18%→0)
- ReferenceLine: ortalama maliyet (dashed, secondary text rengi, sağ kenar etiketi)
- ReferenceDot: alış (yeşil), satış (kırmızı), passive_income (somon). Toggle ile gizlenir
- Hover: dikey crosshair + tooltip (büyük fiyat + tarih)

**Dashboard — `PortfolioTrendChart`**:
- Hero ile dağılım pasta arasında, full width
- Range chip'leri ile filtreleme
- AreaChart, daha kalın stroke (3px)
- Hover tooltip: değer + tarih + "bugüne göre" delta (% + absolute)
- ReferenceLine ve marker yok (gürültü olmasın)

Ortak: Recharts native `animationDuration=400ms easing="ease-out"`, range geçişlerinde smooth morph. Skeleton loading, spinner yok.

### Henüz yapılmayan

- Geçmiş günler için backfill (transactions × o günkü fiyat × o günkü bakiye iterasyonu) — büyük iş, snapshot'lar forward-only birikecek
- Currency cycle grafiklere bağlanmadı — asset chart'ı asset.currency cinsinden gösteriyor (FX rate fetch frontend'de yok)
- WebSocket canlı tick'in son data noktası olarak grafiğe akması (opsiyonel polish)
- Asset modallarında "ödediğim currency" akışı (Phase 2 currency lock turundan kalan iş)
