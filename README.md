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
