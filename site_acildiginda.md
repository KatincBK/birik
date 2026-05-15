# Site açıldığında — Birik Auto-Update Sistem Planı

> Bu doküman, Birik uygulamasını **kendi sitemizden satılabilir + güncellenebilir** bir ürüne dönüştürmek için yapılacakların kayıt defteridir.
> Bugün açık kaynaklı çalışıyoruz (site yok). İleride kapalı kaynak ticari bir ürün olacak.
> Bu geçişte hiçbir şeyin bozulmaması için aşağıdaki kararların **bugün doğru kurulmuş olması** lazım.

---

## TL;DR — 1 paragrafta hikaye

Tauri uygulaması, açılışta sabit bir URL'e (`updates.birik.app/latest.json` gibi) bakar. O URL'deki JSON dosyasında "en son versiyon şu, indirme linki bu, imzası bu" yazar. Yeni versiyon varsa app indirir, imzayı doğrular, kurar. **Bu URL her installer'a hard-code edildiği için bugün koyacağımız URL'i ömür boyu kullanmak zorundayız** — bu yüzden bugün GitHub'a değil, kendi domain'imize işaret eden bir URL koyacağız. Site açıldığında sadece o URL'in arkasındaki host'u değiştireceğiz, kullanıcılar farkına bile varmadan güncellenmeye devam edecek.

---

## Sistemin tam akışı (basit anlatım)

```
[Birik kullanıcısının bilgisayarı]
       │
       │  açılışta GET
       ▼
https://updates.birik.app/latest.json
       │
       │  döner:
       │  { version: "0.3.0",
       │    url: ".../Birik_0.3.0_x64.msi",
       │    signature: "abc123..." }
       │
       ▼
App diyor ki: "Ben 0.2.0'ım, bunda 0.3.0 yazıyor → güncelleme var"
       │
       ▼
.msi'yi indirir → embed edilmiş public key ile .sig'i doğrular
       │
       ▼  imza geçerli mi?
       │
   ✓ Evet  ─► sessizce kurar, uygulamayı yeniden başlatır
   ✗ Hayır ─► işlemi iptal eder (saldırı / bozuk dosya olabilir)
```

**Kritik nokta:** İmza doğrulaması, app'in içine gömülmüş **public key** ile yapılır. Yani biri bizim sitemizi hack'leyip sahte `.msi` koysa bile, o `.msi`'yi bizim **private key** olmadan imzalayamayacağı için kullanıcılar zararlı dosyayı yüklemez. Public key zararsız bir şekilde gömülür, **private key bize ait gizli anahtardır**.

---

## Şu anki durum (snapshot — 2026-05-15)

✅ Var olanlar:
- `tauri-plugin-updater` Cargo'da yüklü (`src-tauri/Cargo.toml`)
- `@tauri-apps/plugin-updater` npm'de yüklü (`package.json`)
- `lib.rs:40`'ta plugin mount edilmiş
- `capabilities/default.json:10`'da `updater:default` izni verilmiş
- `tauri.conf.json:42-51`'de updater config skeleton var

❌ Yapılması gerekenler:
- `tauri.conf.json`'da `"active": false` → `true`
- `endpoints` placeholder URL'i → **gerçek kendi domain URL'imizle değiştir**
- `pubkey` placeholder → **gerçek public key'le değiştir**
- Signing keypair üret
- Domain al + DNS ayarla
- Free hosting kur (Cloudflare Pages / R2)
- Frontend'e "güncelleme var" tetikleyici ekle (toast + buton)
- Build + upload script'i yaz

---

## Faz 1 — BUGÜN yapılacaklar (site yokken bile)

Sıra kritiktir — özellikle domain'i baştan doğru seçmek lazım, sonradan değiştirmek **eski kullanıcıların update almasını imkânsız hale getirir**.

### 1. Domain seç

Bu, ileride dönüşü olmayan tek karardır.

- Tavsiye: ürün adıyla aynı bir domain (örn. `birik.app`, `birikapp.com`, `birik.io`)
- Updater için **subdomain** ayır: `updates.birik.app` (cool görünür + ileride API'ler için root domain serbest kalır)
- Cloudflare / Namecheap / Porkbun'dan ~$10-15/yıl

### 2. Signing keypair üret

```bash
npx @tauri-apps/cli signer generate -w ~/.tauri/birik-updater.key
```

Bu komut iki dosya üretir:
- **private key** (`~/.tauri/birik-updater.key`) — gizli, asla repo'ya commit etme
- **public key** (terminale yazılır) — `tauri.conf.json:47`'deki `pubkey` alanına yapıştır

**Bu private key kaybolursa eski kullanıcılar bir daha update alamaz.** Çift yedek şart:
- 1Password / Bitwarden gibi şifre yöneticisi
- USB stick + offline kasa
- Parolası ayrı yerde saklanacak

### 3. Ücretsiz hosting kur (geçici)

İki seçenek, ikisi de ücretsiz:

**Cloudflare R2 + Pages** (önerilen — geleceğe daha uyumlu):
- R2 bucket'a `.msi` ve `latest.json` koy
- Custom domain bağla: `updates.birik.app` → R2 bucket
- Egress ücretsiz (S3'ten farklı olarak)

**GitHub Releases + Cloudflare proxy** (alternatif — daha hızlı kurulur):
- Build'leri GitHub release'lerine at
- `latest.json` Cloudflare Worker'la dinamik üret veya statik dosya olarak Pages'a at
- Custom domain Cloudflare Pages'e bağla

> **Neden direkt GitHub Releases URL'i değil?** Çünkü endpoint URL'i hard-code. Yarın repo'yu private yapacaksak veya başka yere taşıyacaksak `github.com/...` URL'leri çalışmayacak. Custom domain bizi her zaman kurtarır.

### 4. Endpoint URL'i ve pubkey'i config'e koy

`src-tauri/tauri.conf.json`:
```json
"updater": {
  "active": true,
  "endpoints": [
    "https://updates.birik.app/latest.json"
  ],
  "pubkey": "<step 2'den çıkan public key>",
  "windows": {
    "installMode": "passive"
  }
}
```

### 5. Frontend tetikleyici

App açılışta updater'ı çağıran kod gerekli. Yaklaşık şekli:

```ts
import { check } from "@tauri-apps/plugin-updater";

// App.tsx mount sırasında veya manuel "güncelleme kontrol et" butonunda
const update = await check();
if (update) {
  // toast.info("Yeni versiyon var: " + update.version)
  // kullanıcı "indir" derse:
  await update.downloadAndInstall();
}
```

### 6. Release çıkarma akışı (manuel script)

İlk MVP'de CI yok, lokal yapacağız:

1. `package.json` ve `src-tauri/tauri.conf.json` ve `Cargo.toml`'da version'u artır (örn. 0.1.0 → 0.2.0)
2. `npm run tauri build` → `.msi` + `.sig` üretir (`src-tauri/target/release/bundle/msi/`)
3. `latest.json` dosyasını manuel hazırla:
   ```json
   {
     "version": "0.2.0",
     "notes": "Bu sürümde neler değişti...",
     "pub_date": "2026-06-01T12:00:00Z",
     "platforms": {
       "windows-x86_64": {
         "signature": "<.sig dosyasının içeriği>",
         "url": "https://updates.birik.app/Birik_0.2.0_x64.msi"
       }
     }
   }
   ```
4. `.msi` ve `latest.json`'u R2 bucket'a upload et (rclone / wrangler CLI ile)
5. Test: eski versiyonu çalıştır, "güncelleme var" görmeli

İleride bu adımları `just release 0.2.0` gibi tek komutla otomatikleştirebiliriz.

---

## Faz 2 — SİTE AÇILDIĞINDA yapılacaklar

Bu kısım için bu dokümanı yazıyoruz — açıldığında bu listeyi takip edeceğiz.

### A. Hosting'i siteye taşı (kullanıcılar fark etmeyecek)

DNS'i değiştirmek yeter:
- `updates.birik.app` artık kendi sunucumuza / yeni CDN'imize yönlensin
- `latest.json` ve `.msi` dosyaları yeni host'a kopyalansın
- Eski R2 / Pages bucket'ı kapatılabilir

**Endpoint URL'i (`updates.birik.app/latest.json`) değişmediği için tüm kurulu kullanıcılar sorunsuz update almaya devam eder.** Faz 1'de domain'i baştan doğru seçmenin tüm değeri burada ödüllendiriliyor.

### B. Repo'yu private yap (kapalı kaynağa geçiş)

- GitHub repo Settings → Visibility → Private
- Mevcut user'lara etkisi yok (kullandıkları .msi binary)
- Geliştirme akışı değişmez

### C. Ödeme + lisans sistemi (updater'dan TAMAMEN AYRI bir konu)

Updater "kim ödedi" diye sormaz, sadece imzayı kontrol eder. Lisans için **ayrı bir sistem** lazım:

**Seçenek 1 — Hazır SaaS (kolay):**
- **LemonSqueezy** (Stripe alternatif, KDV otomatik halleder)
- **Paddle** (KDV halleder, kişisel hesap güç)
- **Gumroad** (basit ama sınırlı)

Bunlar lisans key üretir, ödeme alır, KDV/vergi halleder. App açılışta key'i sorar, key'i SaaS API'sine doğrulatır.

**Seçenek 2 — Kendi backend'in:**
- Stripe Checkout entegre et
- Lisans key'i Stripe webhook'tan üret + DB'ye kaydet
- App key'i kendi API'mizden doğrulasın
- Daha fazla iş, daha fazla kontrol

Öneri: **LemonSqueezy** ile başla. Sonra büyürse kendi backend'e geç.

**Lisans key validasyonu app içinde nasıl olmalı?**
- İlk açılışta key sorar → API'ye gönderir → "geçerli" yanıtı alırsa local'e kaydeder
- Periyodik (haftalık?) tekrar doğrular (offline grace period ile)
- Trial mode: 14 gün sınırsız, sonra read-only

### D. Windows Code Signing sertifikası

Bu olmadan kullanıcı `.msi`'yi indirince Windows "bilinmeyen yayıncı, çalıştırma" diye uyarır. Ticari satıyorsak bu bariyer cidden iticidir.

**Seçenekler:**
- **Azure Trusted Signing** — ~$10/ay, en uygun fiyatlı modern çözüm. Microsoft'un yeni servisi.
- **Sectigo / SSL.com EV** — ~$200-400/yıl, daha köklü ama pahalı
- **DigiCert** — ~$400-700/yıl, kurumsal düzey

İlk yıl: Azure Trusted Signing.

Sertifika alındıktan sonra Tauri config'inde `tauri.conf.json` → `bundle.windows` altına `certificateThumbprint` eklenir veya CI build sırasında `signtool` çağrılır.

### E. Otomatik release pipeline (CI)

Manuel `just release` yerine:
- Git tag push edilince (örn. `v0.3.0`) GitHub Actions çalışsın
- Self-hosted runner veya windows-latest'te `npm run tauri build`
- `TAURI_SIGNING_PRIVATE_KEY` ve parolası secret olarak GitHub'da
- `.msi` + `.sig` + `latest.json` otomatik R2/CDN'e push
- Slack/Discord notify

Repo private olduğu için Actions dakikaları ücretli — ayda birkaç release için sorun yok.

---

## Versiyon politikası

[SemVer](https://semver.org/lang/tr/) kullanıyoruz:
- `0.x.y` — beta dönemi (şu an buradayız)
- `1.0.0` — public stable
- Major (1.x.y → 2.x.y): breaking change (DB migration, kullanıcı verisi etkilenir)
- Minor (1.0.x → 1.1.0): yeni özellik
- Patch (1.0.0 → 1.0.1): bug fix

`package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` üçü de **aynı versiyonda** olmak zorunda. İleride `just bump 0.3.0` script'i bunları senkron tutsun.

---

## Eski kullanıcı / migration senaryoları

### Senaryo 1: Sıfırdan başlıyoruz, hiç kullanıcı yok
Şu anki durumumuz. Endpoint URL'i serbestçe seçebiliriz, hata yapma şansımız max.

### Senaryo 2: GitHub'dan birkaç kişi indirmiş, sonra siteye taşıyacağız
Eğer **endpoint URL'i kendi domain'imizdeyse** problem yok, sadece DNS değişir.
Eğer endpoint URL'i `github.com/...`'a bakıyorsa ve repo private olacaksa, eski kullanıcılar son sürümü asla göremez — onlara mail/blog'dan "manuel yeni .msi indir, ondan sonra otomatik olacak" diye duyurmamız lazım.

### Senaryo 3: İmza anahtarı kayboldu
Felaket. Eski binary'lerin doğrulayacağı public key elimizde yoksa yeni binary'leri imzalasak bile validasyon başarısız olur. Çözüm: yeni keypair üret, yeni public key'i içeren bir yeni installer çıkar, kullanıcılara **manuel olarak** yeni versiyona geçmelerini söyle.

Bu yüzden **private key yedeği şart**. Üç yerde tut: şifre yöneticisi + offline USB + güvendiğin biri.

---

## Sıralı checklist (faz 1)

- [ ] Domain satın al (ör. `birik.app`)
- [ ] DNS'i Cloudflare'a taşı (yönetimi merkezi)
- [ ] Cloudflare R2 bucket oluştur, `updates.birik.app` subdomain'ini ona bağla
- [ ] `npx @tauri-apps/cli signer generate` ile keypair üret
- [ ] Private key'i 1Password + USB yedek
- [ ] `tauri.conf.json:47` pubkey güncelle
- [ ] `tauri.conf.json:42` `active: true`
- [ ] `tauri.conf.json:44` endpoint URL'i (`https://updates.birik.app/latest.json`)
- [ ] Frontend'e `check()` ve `downloadAndInstall()` toast UI'sı ekle
- [ ] `just release` script'i yaz (versiyon bump + build + upload + latest.json güncelle)
- [ ] Test: lokal v0.1.0 kur → R2'ye v0.2.0 yükle → app güncellemeyi görsün

## Sıralı checklist (faz 2 — site açıldığında)

- [ ] Site frontend hazır
- [ ] LemonSqueezy / Stripe hesabı aç + ürünü tanımla
- [ ] App'e lisans key prompt + validasyon API'si ekle
- [ ] Trial mode (14 gün) implementasyonu
- [ ] Azure Trusted Signing hesabı + sertifika
- [ ] Tauri build config'e signing thumbprint ekle
- [ ] GitHub Actions release workflow yaz
- [ ] R2'den kendi sunucuya / yeni CDN'e geçiş (DNS değişikliği, dosyalar kopyalanır)
- [ ] Repo'yu private yap
- [ ] Açık kaynak fork'ları varsa kullanıcılarla iletişim (bu fork'ları yok et veya legal süreç)
- [ ] Launch! 🚀

---

## Sözlük (jargon hatırlatma)

- **Endpoint URL**: app'in "güncelleme var mı" diye sorduğu sabit web adresi
- **latest.json**: o URL'in döndürdüğü, son sürüm bilgilerini içeren JSON dosyası
- **Signing keypair**: bizim üretip yanımızda tuttuğumuz iki dosya. **Private** ile imzalarız, **public** app içine gömülür ve imzayı doğrular
- **Code signing certificate**: Windows'a "bu yazılımı bilinen bir şirket çıkardı" diyen ayrı bir sertifika (yukarıdaki keypair'le KARIŞTIRMA)
- **CDN**: dosyaları dünyanın her yerinden hızlıca servis eden ücretli/ücretsiz hosting
- **R2 / S3 bucket**: bulutta dosya konabilen klasör
- **Subdomain**: ana domain'in alt bölümü (`updates.birik.app` → `birik.app`'in updates alt bölümü)
