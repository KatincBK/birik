# Site açıldığında — Birik Auto-Update Sistem Planı

> Bu doküman, Birik uygulamasının **auto-update sistemi**ni ve ileride **portföy sitesi** açıldığında dağıtımın oraya nasıl taşınacağını kayıt altına alır.
> Bugün **GitHub Releases üzerinden ücretsiz** dağıtım yapıyoruz. İleride kendi sitemiz açılınca dağıtımı oraya genişleteceğiz, ama GitHub her zaman geri-uyumluluk için ayakta kalacak.

---

## TL;DR — 1 paragrafta hikaye

Tauri uygulaması, açılışta `tauri.conf.json`'da yazılı bir URL'e bakar. Şu an bu URL **`https://github.com/KatincBK/birik/releases/latest/download/latest.json`**. Yeni bir release çıkardığımızda GitHub bu URL'i otomatik en son sürüme yönlendirir, app yeni sürümü görür, imzayı doğrular, kurar. Portföy sitesi açıldığında `tauri.conf.json` içindeki `endpoints` dizisine **siteyi başa koyacağız**, GitHub Releases ikinci sırada fallback olarak kalacak — yani eski installer'lar da yeni installer'lar da çalışmaya devam edecek.

---

## Sistemin tam akışı

```
[Birik kullanıcısının bilgisayarı]
       │
       │  açılışta GET
       ▼
https://github.com/KatincBK/birik/releases/latest/download/latest.json
       │
       │  GitHub otomatik redirect → en son release'in latest.json'u
       │  döner:
       │  { version: "0.3.0",
       │    url: ".../Birik_0.3.0_x64-setup.exe",
       │    signature: "abc123..." }
       │
       ▼
App diyor ki: "Ben 0.2.0'ım, bunda 0.3.0 yazıyor → güncelleme var"
       │
       ▼
.exe'yi indirir → embed edilmiş public key ile imzayı doğrular
       │
       ▼  imza geçerli mi?
       │
   ✓ Evet  ─► sessizce kurar, uygulamayı yeniden başlatır
   ✗ Hayır ─► işlemi iptal eder
```

---

## Şu anki durum (snapshot — 2026-05-15)

✅ Tamamlanmış:
- `tauri-plugin-updater` Cargo + npm'de yüklü
- `lib.rs:40` plugin mount edildi
- `capabilities/default.json` updater izni verildi
- **Signing keypair üretildi** (private key kullanıcının 1Password / USB yedeğinde, public key config'de)
- `tauri.conf.json`:
  - `active: true` ✓
  - `pubkey` doldu ✓
  - `endpoints` GitHub Releases URL'ine bakıyor ✓
  - `windows.installMode: "passive"`
- Frontend tetikleyici: `src/hooks/useUpdateChecker.ts` + `App.tsx`'te mount edildi

- GitHub Actions workflow `.github/workflows/release.yml` — tag push'unda otomatik build + sign + release
- `v0.1.0` tag push'landı, Actions build alıyor

❌ Henüz yapılmamış:
- Manuel "Güncellemeleri kontrol et" butonu Settings'te (boot dışında manuel tetik)

---

## Release çıkarma akışı

GitHub Actions workflow `.github/workflows/release.yml`'de. Tetik: tag push (`v*`).

Repo Secrets'ta olması gerekenler:
- `TAURI_SIGNING_PRIVATE_KEY` — `birik-updater.key` dosyasının içeriği
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — key parolası

Yeni release çıkarmak:
```bash
# 3 dosyada versiyonu bump et: package.json, Cargo.toml, tauri.conf.json
git commit -am "chore: bump v0.2.0"
git tag v0.2.0
git push origin main v0.2.0
```

Actions windows-latest'te `tauri-action` ile build alır, imzalar, release yayınlar, `latest.json`'u otomatik üretir. ~10-15 dk.

---

## Faz 2 — PORTFÖY SİTESİ AÇILDIĞINDA yapılacaklar

Site açıldığında, dağıtımı oraya genişleteceğiz. Eski kullanıcıların GitHub bağı kopmadan.

### A. Site tarafına `latest.json` ve installer'ı koy

Portföy site'inde `birik/updates/` gibi bir alt-path (veya subdomain) ayır:
```
https://benim-site.com/birik/updates/latest.json
https://benim-site.com/birik/updates/Birik_0.5.0_x64-setup.exe
```

İlk başta sadece bu dosyalar lazım, backend gerekmez.

### B. `tauri.conf.json`'da endpoint'i çoğalt

```json
"endpoints": [
  "https://benim-site.com/birik/updates/latest.json",
  "https://github.com/KatincBK/birik/releases/latest/download/latest.json"
]
```

Updater önce siteyi dener, oradan cevap alamazsa GitHub'a düşer. Yani:
- Yeni installer'ları kullanıcılara siteden indirt
- Eski installer'lar (sadece GitHub URL'i bilen) hâlâ GitHub'dan update almaya devam eder
- Yeni installer'lar (her iki URL'i de bilen) site'den update alır

**Önemli:** Bu config değişikliğinden sonraki release'i hem GitHub Releases'a hem siteye koymalısın — eski installer'lar GitHub'dan, yeni installer'lar site'den çekecek.

### C. (Opsiyonel) Repo'yu private yap

Kapalı kaynak ticari ürüne geçmek istersen:

1. **Sadece ana kod** repo'sunu private yap (`KatincBK/birik`)
2. **Public bir release repo** ayır (`KatincBK/birik-releases`) — sadece release dosyaları
3. Endpoint URL'i o public repo'ya bakar:
   ```
   https://github.com/KatincBK/birik-releases/releases/latest/download/latest.json
   ```
4. GitHub Actions release workflow'u o repo'ya push'lar

Eğer bu noktadayken kullanıcılar zaten siteyi kullanıyorsa, GitHub'ı düşürebilirsin — sadece çok eski kullanıcılar etkilenir.

### D. Ödeme + lisans sistemi

**Önerilen — LemonSqueezy:**
- Stripe alternatif, KDV/vergi otomatik halleder
- Lisans key üretir, satar
- App içinde key prompt + API doğrulaması
- Trial mode (14 gün) yerel saklanır

**Alternatif:** Stripe + kendi backend (daha fazla iş, daha fazla kontrol).

### E. Windows Code Signing sertifikası

Windows SmartScreen "bilinmeyen yayıncı" uyarısını kaldırır.

- **Azure Trusted Signing** — ~$10/ay (önerilen)
- **Sectigo / SSL.com EV** — ~$200-400/yıl
- **DigiCert** — ~$400-700/yıl

Tauri config'inde `bundle.windows` altına thumbprint eklenir.

---

## Eski kullanıcı / migration senaryoları

### Senaryo 1: Site açıldı, kullanıcı v0.4.0 (sadece GitHub bilen sürüm) kullanıyor
- Yeni release v0.5.0 hem GitHub'a hem siteye yüklenirse → kullanıcı GitHub'dan v0.5.0 update'i alır → v0.5.0 installer'ında iki endpoint var → bir sonraki kontrol siteye gider

### Senaryo 2: Repo private yapıldı, eski GitHub URL'i 404 dönüyor
- Eğer site endpoint'i ilk sırada ise updater siteyi dener, oradan alır → sorun yok
- Eğer sadece GitHub URL'i bilen çok eski bir installer varsa → kullanıcı sıkışır → mail/blog ile "manuel yeni .exe indir" duyurusu yapılır

### Senaryo 3: İmza anahtarı kayboldu
- Felaket. Yeni keypair üret → yeni public key içeren bir installer çıkar → kullanıcılara **manuel** olarak yeni installer'a geçmelerini söyle
- Bu yüzden private key 3 yerde yedeklenir (1Password + USB + güvendiğin biri)

---

## Versiyon politikası

[SemVer](https://semver.org/lang/tr/) kullanıyoruz:
- `0.x.y` — beta dönemi (şu an buradayız)
- `1.0.0` — public stable
- Major (1.x.y → 2.x.y): breaking change (DB migration, kullanıcı verisi etkilenir)
- Minor (1.0.x → 1.1.0): yeni özellik
- Patch (1.0.0 → 1.0.1): bug fix

**Üç dosyada versiyon eşit olmak zorunda:**
- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`

İleride `scripts/bump.mjs` veya `just bump 0.3.0` script'i bunları senkron tutsun.

---

## Sıralı checklist

### Faz 1 — Aktif kullanım için kalan işler
- [x] Signing keypair üret + yedekle
- [x] `tauri.conf.json` config (pubkey + endpoint + active)
- [x] Frontend `useUpdateChecker` hook + App mount
- [x] GitHub Actions release workflow
- [x] `v0.1.0` tag push'landı
- [ ] Test: v0.1.0 `.exe`'yi kur → v0.2.0 release çıkar → app açılınca toast görmeli
- [ ] (Opsiyonel) Settings sayfasında "Güncellemeleri kontrol et" butonu — boot dışı manuel tetik

### Faz 2 — Portföy sitesi açıldığında
- [ ] Site frontend hazır
- [ ] `birik/updates/` path'ine `latest.json` + `.exe` koyabilen bir yapı (statik upload ya da CMS)
- [ ] `tauri.conf.json` endpoints dizisine site URL'i başa eklenir, GitHub fallback'te kalır
- [ ] Yeni release: hem site'ye hem GitHub'a aynı dosyaları yükle
- [ ] LemonSqueezy / Stripe hesabı + ürün
- [ ] App'e lisans key prompt + validasyon
- [ ] Trial mode (14 gün)
- [ ] Azure Trusted Signing → .exe code signing
- [ ] (Opsiyonel) Repo'yu private yap, `birik-releases` ayır
- [ ] Launch 🚀

---

## Alternatif: Kendi domain'i kullanmak istersek (referans)

Eğer ileride GitHub yerine kendi domain'imizden update servis etmek istersek:

1. Domain al (örn. `birik.app`, Cloudflare Registrar at-cost)
2. Cloudflare R2 bucket veya Pages projesi oluştur
3. Custom domain bağla (`updates.birik.app` → bucket/project)
4. `latest.json` ve `.exe`'leri buraya upload et
5. `tauri.conf.json` endpoints dizisine bu URL'i en başa ekle, GitHub fallback'te kalır

Bu yol daha pro görünüyor (kendi marka URL'in), ama domain ~$15/yıl + setup vakti gerektiriyor. **Şu an için GitHub Releases yeterli; site açıldığında zaten o sitenin sub-path'ini kullanacağız.**
