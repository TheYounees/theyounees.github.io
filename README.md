# JARVIS — şəxsi süni intellekt köməkçisi

**Canlı sayt:** <https://theyounees.github.io/>  
**APK:** <https://theyounees.github.io/jarvis-release.apk>

Azərbaycan dilində danışan, sizi tanıyan, yadda saxlayan və cihazınızı idarə edən şəxsi köməkçi.
Quraşdırma tələb etmir: saf HTML/CSS/JavaScript, GitHub Pages-də işləyir, bütün yaddaş cihazda qalır.

## İşə salma

1. Saytı açın (GitHub Pages və ya istənilən statik host).
2. İlk ekranda adınızı yazın və provayder seçin.
3. API açarını daxil edin:
   - **Gemini** (tövsiyə olunur, pulsuz): <https://aistudio.google.com/apikey>
   - OpenAI, OpenRouter, Groq və ya lokal Ollama da dəstəklənir.
4. **JARVIS-i işə sal** düyməsini basın.

Açar olmadan da tətbiq açılır, amma "məhdud rejim" olur: yalnız saat, hava və cihaz əmrləri işləyir.

### Telefonda

Saytı Chrome-da açın → menyu → **“Ekrana əlavə et”**. PWA kimi tam ekran işləyəcək.

## APK (Android)

Hazır fayl: **`jarvis.apk`** (debug imzalı, Android 8.0+).

Qurmaq üçün:

1. `jarvis.apk` faylını telefona köçürün.
2. Faylı açın → “Naməlum mənbələrə icazə ver” → **Quraşdır**. Play Protect xəbərdarlıq edə bilər, çünki imza debug imzasıdır.
3. İlk açılışda mikrofon və kamera icazələrini verin.
4. Adınızı yazın, Gemini açarını daxil edin — hər şey hazırdır.

APK ilə brauzer variantı arasındakı fərqlər:

- Veb tətbiq APK-nın içindədir (`assets/www`) — internet olmadan da açılır, API sorğuları üçün internet lazımdır.
- Nitq tanıma və səs sintezi **native** işləyir (WebView-də Web Speech API yoxdur): `SpeechRecognizer` + `TextToSpeech`, Azərbaycan dili dəstəklənmirsə avtomatik türk dilinə keçir.
- Fənər `CameraManager.setTorchMode` ilə — kamera icazəsi kifayətdir, video yazılmır.
- “Jarvis” oyanma sözü native dinləmə dövrəsi ilə işləyir.
- Zəng, SMS, xəritə, YouTube/Spotify kimi keçidlər Android niyyətləri (intent) ilə açılır.

### APK-nı yenidən qurmaq

```bash
# tələblər: JDK 17, Android build-tools 34.0.0, platform android-34
export JAVA_HOME=/yol/jdk ANDROID_SDK_ROOT=/yol/android-sdk

bash android/make-release-key.sh   # yalnız ilk dəfə — öz imza açarınızı yaradır
bash android/build.sh release      # → jarvis-release.apk
bash android/build.sh debug        # → jarvis.apk (sürətli test üçün)
```

- Versiya artırmaq: `VERSION_CODE=3 VERSION_NAME=1.2 bash android/build.sh release`
- Ölçü optimallaşdırması: JS/CSS `esbuild` ilə minifikasiya olunur (`android/optimize`), `javac -g:none`, **R8** (shrink + obfuscation), `zip -9`; native qabıqda işləməyən `sw.js` paketə salınmır.
- R8-i söndürmək: `USE_R8=0 bash android/build.sh release`
- R8 qaydaları: `android/proguard-rules.pro` — `@JavascriptInterface` metodları və `MainActivity`/`Bridge` sinifləri saxlanılır. Obfuscation xəritəsi: `android/build/mapping.txt`.
- Minifikasiya üçün bir dəfə: `cd android/optimize && npm install` (esbuild yoxdursa build minifikasiyasız davam edir).
- İmza açarı `android/keystore/` qovluğundadır və `.gitignore` ilə repodan kənardadır. **Bu iki faylı itirməyin** — itsə, eyni imza ilə yeni versiya buraxa bilməyəcəksiniz.

Build Gradle istifadə etmir — `aapt2`, `javac`, `d8`, `zipalign`, `apksigner` ilə birbaşa yığılır.

### R8 nəticəsi (ölçülmüş)

| Göstərici | R8-siz | R8 ilə | Fərq |
| --- | --- | --- | --- |
| `classes.dex` (xam) | 23,512 B | 20,936 B | **−2,576 B (−11.0%)** |
| `classes.dex` (sıxılmış) | 10,837 B | 10,288 B | −549 B (−5.1%) |
| APK (ümumi) | 62,840 B | 62,840 B | ±0 |

APK-nın ümumi ölçüsü dəyişmədi, çünki `apksigner` imza blokunu elə doldurur ki, ZIP mərkəzi kataloqu 4096 bayta düzülsün — 549 baytlıq qənaət dolğuya keçdi. Növbəti 4096 baytlıq pilləyə düşmək üçün içindəkiləri təxminən **3.5 KB** daha kiçiltmək lazımdır (məsələn JS-i tək bundle-a yığmaq + HTML minifikasiyası).

R8-in real faydası: dex 11% kiçildi, köməkçi siniflər obfuscate olundu (`MainActivity$a…g`), JS körpüsü və `@JavascriptInterface` anotasiyası toxunulmaz qaldı.

### Versiya tarixçəsi

- **3.0** (versionCode 21) — Drive artıq **JARVIS qovluğunda 4 ayrı fayl** saxlayır: `profil.json`, `sohbetler.json`, `ayarlar.json`, `qeydler.json`; tənzimləmələrdə **“Sinxronlaşdır”** düyməsi Drive-dakı söhbətləri tətbiqə qaytarır. Giriş qapısı ilk kadrdan görünür (menyu flash-i yox), giriş həm veb yaddaşında, həm telefon yaddaşında saxlanılır. Girişdən sonra API açarı soruşulmur — yalnız Tənzimləmələrdə. Asistan açılışında “Salam, Yunis. Buyurun, sizi dinləyirəm.” salamlaması və avtomatik mikrofon. `navigate` üçün qoruma (“nə?” kimi sözlərlə marşrut açılmır). Groq vision dublikat provayder qeydi silindi.
- **2.9** (versionCode 20) — Naviqasiya konteksti: "bunu/onu Google xəritədə aç" əvvəlki mənzili seçilmiş proqramda açır; "Google Maps/Xəritələr" adları paketə uyğunlaşdırılır. Drive faylı artıq **My Drive-da görünən** `JARVIS-yaddas.json`-dur (`drive.file` scope, oxunaqlı JSON) — əvvəlki `appDataFolder` faylı Drive interfeysində görünmürdü. Asistan/icazə düymələri vizual cavab verir, "Asistan ayarları" düyməsi əlavə olundu. Giriş ekranı (istifadəçi adı + şifrə hash-i, bir dəfə) və "Çıxış" düyməsi.
- **2.8** (versionCode 19) — Kontekstli əmrlər: "yenə aç / təkrar aç" son açılan tətbiqi açır; naviqasiya əmrləri artıq tətbiq adı kimi yozulmur (`commands.js`). Waze üçün rəsmi `https://waze.com/ul?q=...&navigate=yes` linki (əvvəlki `waze://?q=` "Unknown error" verirdi). Varsayılan rəqəmsal asistan dəstəyi: `VoiceInteractionService` + `SessionService` + `ACTION_ASSIST` + `RoleManager` düyməsi. Arxa planda oyanma üçün tam ekran bildiriş fallback-i. Google Drive 403 xətaları artıq səbəbi ilə göstərilir (Drive API aktiv deyil / scope). Veb yaddaşının telefon yaddaşında ehtiyat nüsxəsi (ad və API açarı bir dəfə soruşulur).
- **2.7** (versionCode 18) — Tətbiq açma tam yenidən yazıldı: `QUERY_ALL_PACKAGES` + launcher sorğusu ilə bütün quraşdırılmış tətbiqlər görünür; `AppMatch` səlis uyğunlaşdırma ("pubg" → PUBG MOBILE, "vatsap" → WhatsApp). Google OAuth üçün **client secret** sahəsi əlavə edildi (Google PKCE-də də tələb edir) və xəta mesajları Azərbaycan dilinə çevrildi.
- **2.6** (versionCode 17) — Google Drive OAuth xarici brauzerdə tamamlanır və `azjarvis://oauth` deep link ilə tətbiqə qayıdır (NXDOMAIN problemi həll olundu); yerli konum (GPS/şəbəkə) və `navigate` əmri (Waze, Yandex Navi, Google Maps); model markdown düymə yaratmır; tətbiq açma dərhal icra olunur.
- **2.5** (versionCode 16) — “X aç / X-ə gir” əmri native mühitdə dərhal icra olunur (modelə getmədən, əlavə təsdiq istəmədən); quraşdırılmayan tətbiq üçün Google axtarışı əvəzinə Play Store göstərilir; model “düyməyə bas” demir.
- **2.4** (versionCode 15) — Groq şəkil dəstəyi (qwen/qwen3.8-27b və Llama 4 vision modelləri); sürətli əmrlər düymələri işləyir; native telefon idarəetməsi (tətbiq açma, zəng, SMS, bildiriş, batareya, bufer, paylaşma, ayarlar, alarm); arxa plan oyanma xidməti möhkəmləndirildi (bildiriş icazəsi, mic yoxlaması).
- **2.3** (versionCode 14) — Groq 413/TPM xətası düzəldildi: standart model `llama-3.3-70b-versatile`, sorğu token büdcəsi (6000) və 413 zamanı avtomatik qısaltma/model rotasiyası; ayrı-ayrı söhbətlər və sol menyuda keçmiş söhbətlər; Google Drive sinxronizasiyası bütün söhbətləri əhatə edir; “jarvis” arxa plan foreground service-i və boot-da bərpa.
- **2.1** (versionCode 12) — Gemini 429/404 verəndə avtomatik yüngül modelə keçid (hər modelin kvotası ayrıdır); Groq və OpenRouter provayderləri geri əlavə edildi; 402 gözləməsi maksimum 4 saniyə.
- **2.0** (versionCode 11) — pulsuz ehtiyat rejimi tamamilə çıxarıldı (113 saniyəlik gözləmənin səbəbi); açar yoxdursa dərhal "Açar lazımdır" mesajı və görünən "🔑 Gemini açarını qoş" düyməsi; 400 xətası üçün aydın izah; modelin uydurma alət adları rədd edilir.
- **1.9** (versionCode 10) — beyin yalnız Gemini (digər provayderlər gizlədildi), açar yazılanda provayder avtomatik Gemini olur, sorğu timeout-u 15 saniyə, fənər/saat kimi əmrlər modelə getmədən dərhal icra olunur.
- **1.8** (versionCode 9) — provayder cavab verməyəndə sorğu 45 saniyədən sonra kəsilir (əbədi spinner yox), canlı saniyə sayğacı və göndərmə düyməsi ilə dayandırma.
- **1.7** (versionCode 8) — pulsuz rejim limiti (402/429) xəta kimi göstərilmir: JARVIS sayğacla gözləyir və cavabı avtomatik tamamlayır.
- **1.6** (versionCode 7) — service worker şəbəkə-öncəlli işləyir və brauzerin HTTP keşini keçir, ona görə yeniləmələr dərhal görünür.
- **1.5** (versionCode 6) — pulsuz rejimdə alət nəticələri təbii cümlə ilə verilir (texniki JSON əvəzinə).
- **1.4** (versionCode 5) — yeni quraşdırmada standart olaraq açarsız pulsuz rejim seçilir; onboarding-də “açarsız başla” düyməsi birbaşa pulsuz rejimi aktivləşdirir.
- **1.3** (versionCode 4) — etibarlılıq: 429/5xx cavablarında avtomatik yenidən cəhd, provayder cavab vermədikdə açarsız “Pulsuz” beyinə keçid (ehtiyat rejim), pulsuz rejimdə alət nəticələrinin oxunaqlı təqdimatı, model siyahısının açarsız provayderdə də çəkilməsi.
- **1.2** (versionCode 3) — model 404 düzəlişi: standart model `gemini-3.8-flash`, tənzimləmələrdə provayderdən model siyahısı (“Gətir”) və 404 zamanı avtomatik model seçimi; əlavə şəkil önizləməsinin boş görünməsi düzəldildi. Google 2.5 modellərini yeni açarlar üçün bağladığı üçün köhnə `gemini-2.5-flash` 404 verirdi.
- **1.1** (versionCode 2) — öz release imzası, JS/CSS minifikasiyası, ölçü optimallaşdırması (66 KB → 62 KB).
- **1.0** (versionCode 1) — ilk debug imzalı APK.

## Nə edə bilir

| Sahə | İmkan |
| --- | --- |
| Ünsiyyət | Azərbaycan dilində təbii, qısa və dəqiq cavablar; lazım olanda ətraflı izah |
| Yaddaş | Ad, şəhər, maraqlar, vərdişlər və söhbət tarixçəsi `localStorage`-da saxlanılır |
| Səs | Nitqi tanıyır (Web Speech API), cavabı səslə oxuyur (SpeechSynthesis) |
| Oyanma sözü | “Jarvis” deyəndə dinləməyə başlayır |
| Axtarış | Tavily açarı ilə veb axtarış; olmadıqda Azərbaycan Vikipediyası |
| Hava | Open-Meteo ilə cari hava və 3 günlük proqnoz (açar tələb etmir) |
| Riyaziyyat | Təhlükəsiz kalkulyator, faiz, kök, triqonometriya |
| Plan | Taymer, qeydlər, gündəlik plan qurma |
| Cihaz | Fənər, Bluetooth, zəng, SMS, tətbiq açma, musiqi, bildiriş, vibrasiya, bufer, məkan, batareya, paylaşma |
| Şəkil | Kamera ilə şəkil əlavə edib “bax, bu nədir?” deyə bilərsiniz (model dəstəkləyirsə) |

## Cihaz əmrləri və məhdudiyyətlər

Brauzer tətbiqi olduğu üçün bəzi şeylər mümkün deyil — JARVIS bunu uydurmur, açıq deyir.

- **Fənər** yalnız Android Chrome-da, kamera icazəsi ilə işləyir.
- **Bluetooth** Web Bluetooth dəstəkləyən brauzer istəyir (Android Chrome, kompüter Chrome/Edge).
- **Zəng / SMS / tətbiq açma** brauzerdən avtomatik başladıla bilməz; JARVIS təsdiq düyməsi verir, siz basırsınız.
- **Sistem ayarları** (Bluetooth-u söndürmək, Wi-Fi, ekran parlaqlığı) veb tətbiqindən idarə olunmur — bu, brauzer təhlükəsizlik modelidir. Tam nəzarət üçün Android üçün ayrıca native qat (Kotlin + bu API) lazımdır.
- Nitqin tanınması Chrome/Edge-də ən yaxşı işləyir və internet tələb edir.

## Məxfilik

- API açarı, profil, xatirələr, qeydlər və söhbətlər yalnız `localStorage`-da saxlanılır.
- Mesajlar birbaşa seçdiyiniz provayderə göndərilir; başqa server yoxdur.
- **İxrac et** funksiyası API açarlarını fayla yazmır.
- Şifrə, kart nömrəsi kimi həssas məlumatları yadda saxlamamaq sistemi təlimatında ayrıca qaydadır.
- “Söhbəti təmizlə” yalnız tarixçəni silir; xatirələr qalır (onları paneldən ayrıca silmək olar).

## Quruluş

```
index.html                  interfeys qabığı
assets/styles.css           HUD dizaynı
assets/js/config.js         provayderlər, standart ayarlar
assets/js/store.js          yaddaş və profil (localStorage)
assets/js/llm.js            sistem təlimatı + chat completions + alət dövrü
assets/js/tools.js          alətlər (hava, axtarış, cihaz, taymer...)
assets/js/voice.js          nitq tanınması, sintez, oyanma sözü
assets/js/ui.js             DOM, markdown, vizualizator
assets/js/app.js            hadisələr və axın
sw.js                       oflayn qabıq
android/                    APK qabığı (WebView + native körpü)
  AndroidManifest.xml
  src/az/jarvis/app/MainActivity.java
  build.sh                  Gradle-sız APK build
```

## Yeni funksiya əlavə etmək

1. `assets/js/tools.js` faylında `TOOL_DEFS` massivinə alətin sxemini əlavə edin.
2. Eyni faylda `executeTool` funksiyasına `case` yazın.
3. Lazım olsa `assets/js/config.js`-də provayder və ya qısa əmrləri yeniləyin.

Model aləti avtomatik görür — sistem təlimatında adı keçdiyi üçün çağırışları da düzgün edir.

## Texniki qeydlər

- API: OpenAI-uyğun `POST {baseUrl}/chat/completions`, `tools` + `tool_choice: auto`.
- Gemini üçün OpenAI-uyğun endpoint istifadə olunur: `.../v1beta/openai`.
- Alət dövrü maksimum 5 raunddur; hər çağırış UI-da kiçik telemetriya sətri kimi görünür.
