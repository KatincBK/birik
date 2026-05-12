# Birik

Kişisel kullanım için, yüksek "game feel" hissi veren bir desktop **portföy takip uygulaması**. Kripto, ABD hisseleri, döviz ve altın varlıklarını takip eder; işlem geçmişini girer; kar-zararı izler; fiyat alarmları kurar; yatırım hedefleri belirler.

> Felsefe: Sessiz bir Excel değil, oynanan bir oyun gibi — ama abartısız, "Apple Pay" zarafetinde.

---

## Öne çıkan özellikler

- **Çoklu portföy** + "Hepsi" konsolide görünüm
- **Kripto / Hisse / Döviz / Altın** — tek arayüz
- Veri kaynakları **API key gerektirmez**:
  - Kripto: CoinGecko
  - ABD hisseleri: Yahoo Finance
  - Döviz / Altın: TCMB günlük XML
- **5 dk TTL fiyat cache** (SQLite), **5 dk'lık background loop** ile alarmları kontrol eder, eşik geçince **OS bildirimi** gönderir
- **Pasif gelir paneli** — staking / temettü / faiz breakdown, aylık trend
- **Hedefler** — animasyonlu progress bar, ETA hesabı, hedef ulaşma celebration sahnesi (confetti + ses)
- **Click-to-cycle currency** (USD ↔ TRY ↔ EUR ↔ …) — Y ekseninde 90° flip animasyonu
- **Skeleton screens** her yerde (spinner yok), **count-up sayı animasyonu**, **fiyat değişiminde flash**
- Web Audio API ile **programmatic ses efektleri** (5 ses: ding/swoosh/click/error/achievement) — mp3 dosyası yok, app self-contained
- **Klavye kısayolları** — Ctrl+K (varlık ara), Ctrl+N (yeni), Ctrl+R (yenile), Ctrl+, (ayarlar), Esc (modal kapat)
- **Yedekleme** — manuel JSON export/import (replace + merge), günlük otomatik backup (AppData, 7 günlük rotasyon)
- **Çevrimdışı destekli** — internet kesilince cache'den çalışır, üst barda "Çevrimdışı" rozeti
- **Dark mode only**, Geist font, somon (#FF8B7A) accent

---

## Teknoloji

- **Tauri 2.x** (Rust backend + WebView frontend)
- **React 19** + **TypeScript** + **Vite 7**
- **Tailwind CSS v4** (`@theme` design tokens)
- **SQLite** (`tauri-plugin-sql` + Rust-side `sqlx::migrate!`)
- **Recharts** (pie + bar chart)
- **Framer Motion** (animasyonlar)
- **Sonner** (toast)
- **Zustand** (state)

---

## Kurulum

### Gereksinimler

- **Rust** ≥ 1.78 — [rustup.rs](https://rustup.rs/)
- **Node.js** ≥ 20 + npm
- **Windows**: Microsoft C++ Build Tools (cargo'nun ihtiyacı)

### Geliştirme

```bash
git clone <repo>
cd birik
npm install
npm run tauri dev
```

İlk derleme ~2 dk sürer (Rust dependencies). Sonraki başlatmalar cache'ten saniyeler içinde açılır.

### Production build

```bash
npm run tauri build
```

Çıktı: `src-tauri/target/release/bundle/`
- Windows: `msi/birik_0.1.0_x64_en-US.msi` ve `nsis/birik_0.1.0_x64-setup.exe`

---

## Kullanım

1. **Varlık Ekle** (Ctrl+K) → tip seç (kripto/hisse/döviz/altın) → ara → seç
2. **İşlem Ekle** (asset detayına gir → Ctrl+N) → alış/satış/pasif gelir formu
3. **Yenile** (Ctrl+R) → cache'i temizle, fiyatları çek
4. **Currency cycle** → Hero'daki büyük rakama tıkla
5. **Alarmlar** → sidebar → eşik kur → background loop 5 dk'da bir kontrol eder
6. **Hedefler** → progress bar takibi, ulaşınca celebration

### Veri konumu

`%APPDATA%\com.birik.app\` (Windows)
- `birik.db` — ana veritabanı (WAL mode)
- `backups/` — günlük otomatik yedekler (7-day rotation)

### Yedekleme

**Ayarlar** sayfasında:
- **Dışa aktar** — istediğin yere JSON
- **Şimdi yaz** — AppData/backups klasörüne anlık snapshot
- **Birleştir** — yedek dosyasındaki yeni öğeleri ekle, mevcutları koru
- **Değiştir** — tüm verileri sil + yedektekilerle değiştir

---

## Geliştirme notları

### Mimari

- `src/` — React frontend
  - `pages/` — sayfa-seviyesi bileşenler (Dashboard, AssetDetail, PassiveIncome, Alerts, Goals, Settings)
  - `components/` — ortak UI (Modal, Sidebar, Hero, AssetTable…)
  - `stores/` — Zustand store'ları
  - `hooks/` — özel hook'lar
  - `lib/` — yardımcılar (api wrapper, format, sounds, celebrate, cn)
- `src-tauri/` — Rust backend
  - `src/commands/` — Tauri komutları (CRUD + business logic)
  - `src/services/` — DB pool, HTTP client, price fetcher'lar (CoinGecko/Yahoo/TCMB), cache, alarm loop, backup loop
  - `src/db/migrations/` — versiyonlu SQL migration'ları
  - `src/error.rs` — `AppError` (thiserror)

### Test

```bash
# Calc layer unit tests (avg cost, sale validation, FX conversion)
cd src-tauri && cargo test --lib

# Live API integration tests (CoinGecko/Yahoo/TCMB) — internet ister
cargo test --test live_apis -- --ignored
```

### Tauri 2 plugin'leri

- `tauri-plugin-sql` — DB load (frontend kullanmıyor şu an)
- `tauri-plugin-notification` — alarm OS notification
- `tauri-plugin-updater` — şu an `active: false`
- `tauri-plugin-dialog` — file save/open
- `tauri-plugin-fs` — read/write text file (manuel export/import)

### Önemli kararlar

- **Veritabanı migration sahibi tek**: Rust `sqlx::migrate!`. plugin-sql migration listesi boş bırakıldı.
- **Programmatic ses**: Web Audio API ile 5 ses runtime'da üretiliyor; ek dosya yok.
- **WAL mode** SQLite — concurrent read/write için.
- **Background loop**: tokio::spawn — 5 dk alarm tick + 24 saat backup tick.

---

## Auto-updater'ı aktive etme

`tauri.conf.json` içinde updater scaffold'ı kurulu (`active: false`). Açmak için:

```bash
# 1) Anahtar çifti üret (private'ı GÜVENLİ tut, Git'e commit etme)
npx tauri signer generate -w ~/.tauri/birik.key

# 2) tauri.conf.json'da:
#    - plugins.updater.active → true
#    - plugins.updater.pubkey → komutun bastığı public key
#    - plugins.updater.endpoints → kendi release URL'in
```

Build sırasında `TAURI_SIGNING_PRIVATE_KEY` env var'ı olarak private key path'i ver:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "C:\Users\you\.tauri\birik.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "..."
npm run tauri build
```

Çıktı `.msi.zip` ve `.msi.zip.sig` (imza) dosyalarıdır. GitHub release'e ekleyip `latest.json`'da imzaya pointer ver.

---

## Yol haritası

- [x] Stooq.com CSV fallback (Yahoo bozulursa) ✓
- [x] Tempolu hedef ETA (portfolio_snapshots tablosu + 30g lineer projeksyon) ✓
- [x] Daily change rozeti (24h %) ✓
- [x] Currency conversion in alarm check ✓
- [ ] Updater pubkey üret + endpoint config (kullanıcı tarafı, yukarıdaki adımlar)
- [ ] Mac/Linux build doğrulamaları

---

## Lisans

Kişisel kullanım. Kapat-aç et — kimse seni bağlamıyor.
