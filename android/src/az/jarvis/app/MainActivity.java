package az.jarvis.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.view.KeyEvent;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * JARVIS APK qabığı.
 * Veb tətbiq assets/www içindədir və https://appassets.androidplatform.net ünvanından verilir.
 * Brauzerdə olmayan native imkanlar (nitq tanıma, TTS, fənər, vibrasiya, fayl seçimi) JS körpüsü ilə açılır.
 */
public class MainActivity extends Activity {

    private static final String HOST = "appassets.androidplatform.net";
    private static final int REQ_FILE = 1001;
    private static final int REQ_PERMS = 1002;

    private WebView web;
    private ValueCallback<Uri[]> filePathCallback;

    private SpeechRecognizer recognizer;
    private boolean wakeRunning = false;
    private boolean wakeEnabled = false;
    private String sttLang = "az-AZ";
    private boolean sttFallbackTried = false;

    private TextToSpeech tts;
    private boolean ttsReady = false;
    private String pendingSpeech = null;
    private float pendingRate = 1f;
    private float pendingPitch = 0.92f;

    private CameraManager cameraManager;
    private String torchCameraId = null;

    private long lastLevelEmit = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().setStatusBarColor(0xFF05080C);
        getWindow().setNavigationBarColor(0xFF05080C);

        cameraManager = (CameraManager) getSystemService(CAMERA_SERVICE);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF05080C);

        web = new WebView(this);
        web.setBackgroundColor(0xFF05080C);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);

        WebView.setWebContentsDebuggingEnabled(true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (HOST.equals(uri.getHost())) {
                    return assetResponse(uri.getPath());
                }
                return null;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleExternal(request.getUrl());
            }

            @SuppressWarnings("deprecation")
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleExternal(Uri.parse(url));
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> request.grant(request.getResources()));
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                callback.invoke(origin, true, false);
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;
                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("image/*");
                try {
                    startActivityForResult(Intent.createChooser(intent, "Şəkil seç"), REQ_FILE);
                    return true;
                } catch (Exception e) {
                    filePathCallback = null;
                    return false;
                }
            }
        });

        web.addJavascriptInterface(new Bridge(), "JarvisNative");
        root.addView(web, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        requestAppPermissions();
        initTts();
        web.loadUrl("https://" + HOST + "/index.html");
    }

    private void requestAppPermissions() {
        ArrayList<String> wanted = new ArrayList<>();
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            wanted.add(Manifest.permission.RECORD_AUDIO);
        }
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            wanted.add(Manifest.permission.CAMERA);
        }
        if (wanted.isEmpty()) return;
        requestPermissions(wanted.toArray(new String[0]), REQ_PERMS);
    }

    /* ---------------- asset xidməti ---------------- */

    private WebResourceResponse assetResponse(String path) {
        String clean = (path == null) ? "index.html" : path;
        while (clean.startsWith("/")) clean = clean.substring(1);
        if (clean.isEmpty()) clean = "index.html";
        if (clean.contains("..")) {
            return new WebResourceResponse("text/plain", "utf-8",
                    new ByteArrayInputStream("404".getBytes()));
        }
        try {
            InputStream is = getAssets().open("www/" + clean);
            String mime = mimeFor(clean);
            boolean textual = mime.startsWith("text/") || mime.contains("javascript")
                    || mime.contains("json") || mime.contains("xml") || mime.contains("svg");
            WebResourceResponse response = new WebResourceResponse(mime, textual ? "utf-8" : null, is);
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-cache");
            headers.put("Access-Control-Allow-Origin", "*");
            response.setResponseHeaders(headers);
            return response;
        } catch (IOException e) {
            return new WebResourceResponse("text/plain", "utf-8",
                    new ByteArrayInputStream("404".getBytes()));
        }
    }

    private String mimeFor(String name) {
        if (name.endsWith(".html")) return "text/html";
        if (name.endsWith(".js")) return "application/javascript";
        if (name.endsWith(".css")) return "text/css";
        if (name.endsWith(".json")) return "application/json";
        if (name.endsWith(".webmanifest")) return "application/manifest+json";
        if (name.endsWith(".svg")) return "image/svg+xml";
        if (name.endsWith(".png")) return "image/png";
        if (name.endsWith(".woff2")) return "font/woff2";
        if (name.endsWith(".woff")) return "font/woff";
        return "application/octet-stream";
    }

    /* ---------------- xarici keçidlər ---------------- */

    private boolean handleExternal(Uri uri) {
        if (uri == null) return false;
        String scheme = uri.getScheme();
        if (scheme == null) return false;
        if (HOST.equals(uri.getHost())) return false;
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (Exception ignored) {
            /* uyğun tətbiq yoxdur */
        }
        return true;
    }

    /* ---------------- JS körpüsü ---------------- */

    private class Bridge {

        @JavascriptInterface
        public boolean available() {
            return true;
        }

        @JavascriptInterface
        public String deviceInfo() {
            try {
                JSONObject o = new JSONObject();
                o.put("model", Build.MANUFACTURER + " " + Build.MODEL);
                o.put("sdk", Build.VERSION.SDK_INT);
                o.put("app", "JARVIS APK");
                try {
                    o.put("version", getPackageManager().getPackageInfo(getPackageName(), 0).versionName);
                } catch (Exception e) {
                    o.put("version", "");
                }
                return o.toString();
            } catch (Exception e) {
                return "{}";
            }
        }

        @JavascriptInterface
        public void startListening() {
            runOnUiThread(() -> startRecognition(false));
        }

        @JavascriptInterface
        public void stopListening() {
            runOnUiThread(MainActivity.this::destroyRecognizer);
        }

        @JavascriptInterface
        public void startWakeWord() {
            runOnUiThread(() -> {
                wakeEnabled = true;
                wakeRunning = true;
                JarvisWakeService.setWakeEnabled(MainActivity.this, false);
                startRecognition(true);
            });
        }

        @JavascriptInterface
        public void stopWakeWord() {
            runOnUiThread(() -> {
                wakeEnabled = false;
                wakeRunning = false;
                destroyRecognizer();
                JarvisWakeService.setWakeEnabled(MainActivity.this, false);
            });
        }

        @JavascriptInterface
        public void speak(final String text, final float rate, final float pitch) {
            runOnUiThread(() -> {
                pendingSpeed(rate, pitch);
                if (!ttsReady || tts == null) {
                    pendingSpeech = text;
                    return;
                }
                pendingSpeech = null;
                tts.setSpeechRate(clamp(rate, 0.4f, 2f));
                tts.setPitch(clamp(pitch, 0.4f, 2f));
                tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "jarvis-" + System.currentTimeMillis());
            });
        }

        @JavascriptInterface
        public void stopSpeaking() {
            runOnUiThread(() -> {
                pendingSpeech = null;
                if (tts != null) tts.stop();
            });
        }

        @JavascriptInterface
        public boolean torch(boolean on) {
            return setTorch(on);
        }

        @JavascriptInterface
        public void vibrate(int ms) {
            try {
                Vibrator v = (Vibrator) getSystemService(VIBRATOR_SERVICE);
                if (v == null || !v.hasVibrator()) return;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    v.vibrate(ms);
                }
            } catch (Exception ignored) {
                /* vibrasiya yoxdur */
            }
        }

        @JavascriptInterface
        public void openUrl(String url) {
            handleExternal(Uri.parse(url));
        }

        @JavascriptInterface
        public boolean hasMicPermission() {
            return checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
        }

        @JavascriptInterface
        public void requestPermissionsNow() {
            runOnUiThread(MainActivity.this::requestAppPermissions);
        }
    }

    private void pendingSpeed(float rate, float pitch) {
        this.pendingRate = rate;
        this.pendingPitch = pitch;
    }

    private static float clamp(float v, float min, float max) {
        return Math.max(min, Math.min(max, v));
    }

    /* ---------------- nitqin tanınması ---------------- */

    private void startRecognition(final boolean wakeMode) {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            if (!wakeMode) {
                emit("error", "Bu cihazda nitq tanınması xidməti yoxdur. Google tətbiqini yeniləyin.");
                emit("end", "");
            }
            return;
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            if (!wakeMode) {
                emit("error", "Mikrofon icazəsi verilməyib.");
                emit("end", "");
            }
            requestAppPermissions();
            return;
        }

        destroyRecognizer();

        recognizer = SpeechRecognizer.createSpeechRecognizer(this);
        recognizer.setRecognitionListener(new RecognitionListener() {
            @Override
            public void onReadyForSpeech(Bundle params) {
                if (!wakeMode) emit("start", "");
            }

            @Override
            public void onBeginningOfSpeech() {
            }

            @Override
            public void onRmsChanged(float rmsdB) {
                long now = System.currentTimeMillis();
                if (now - lastLevelEmit < 120) return;
                lastLevelEmit = now;
                emit("level", String.valueOf(rmsdB));
            }

            @Override
            public void onBufferReceived(byte[] buffer) {
            }

            @Override
            public void onEndOfSpeech() {
            }

            @Override
            public void onError(int error) {
                if (wakeMode) {
                    restartWakeSoon();
                    return;
                }
                if ((error == SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED
                        || error == SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE)
                        && !sttFallbackTried) {
                    sttFallbackTried = true;
                    sttLang = "tr-TR";
                    startRecognition(false);
                    return;
                }
                if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                    emit("error", "Səs eşitmədim.");
                } else if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
                    emit("error", "Mikrofon icazəsi verilməyib.");
                } else if (error == SpeechRecognizer.ERROR_NETWORK || error == SpeechRecognizer.ERROR_NETWORK_TIMEOUT) {
                    emit("error", "Nitq xidməti üçün internet lazımdır.");
                } else if (error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY) {
                    emit("error", "Nitq xidməti məşğuldur, bir az sonra cəhd edin.");
                } else {
                    emit("error", "Nitq tanınmadı (xəta " + error + ").");
                }
                emit("end", "");
            }

            @Override
            public void onResults(Bundle results) {
                ArrayList<String> list = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                String text = (list != null && !list.isEmpty()) ? list.get(0) : "";
                if (wakeMode) {
                    String lower = text.toLowerCase(new Locale("az"));
                    if (lower.contains("jarvis") || lower.contains("carvis") || lower.contains("jarviz")
                            || lower.contains("çarvis")) {
                        wakeRunning = false;
                        emit("wake", text);
                    } else {
                        restartWakeSoon();
                    }
                    return;
                }
                emit("final", text);
                emit("end", text);
            }

            @Override
            public void onPartialResults(Bundle partialResults) {
                ArrayList<String> list = partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                if (list != null && !list.isEmpty()) emit("interim", list.get(0));
            }

            @Override
            public void onEvent(int eventType, Bundle params) {
            }
        });

        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, sttLang);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, sttLang);
        intent.putExtra(RecognizerIntent.EXTRA_ONLY_RETURN_LANGUAGE_PREFERENCE, false);
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getPackageName());

        try {
            recognizer.startListening(intent);
        } catch (Exception e) {
            if (wakeMode) {
                restartWakeSoon();
            } else {
                emit("error", "Mikrofonu işə salmaq alınmadı.");
                emit("end", "");
            }
        }
    }

    private void restartWakeSoon() {
        if (!wakeRunning) return;
        if (web == null) return;
        web.postDelayed(() -> {
            if (wakeRunning) startRecognition(true);
        }, 500);
    }

    private void destroyRecognizer() {
        if (recognizer != null) {
            try {
                recognizer.cancel();
                recognizer.destroy();
            } catch (Exception ignored) {
                /* artıq bağlanıb */
            }
            recognizer = null;
        }
    }

    /* ---------------- TTS ---------------- */

    private void initTts() {
        tts = new TextToSpeech(this, status -> {
            if (status != TextToSpeech.SUCCESS || tts == null) {
                emit("error", "Səs sintezi işə düşmədi. Google TTS quraşdırın.");
                return;
            }
            int result = tts.setLanguage(new Locale("az", "AZ"));
            if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
                result = tts.setLanguage(new Locale("tr", "TR"));
            }
            if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
                tts.setLanguage(Locale.getDefault());
            }
            // Daha canli, təbii səs seçimi (premium/natural varsa).
            try {
                java.util.Set<android.speech.tts.Voice> voices = tts.getVoices();
                if (voices != null && !voices.isEmpty()) {
                    android.speech.tts.Voice best = null;
                    int bestScore = -1000;
                    for (android.speech.tts.Voice v : voices) {
                        if (v == null) continue;
                        String name = String.valueOf(v.getName()).toLowerCase();
                        Locale loc = v.getLocale();
                        boolean azOrTr = loc != null && (loc.getLanguage().equals("az") || loc.getLanguage().equals("tr"));
                        int score = 0;
                        if (azOrTr) score += 10;
                        if (name.contains("natural") || name.contains("premium") || name.contains("neural") || name.contains("wavenet")) score += 8;
                        if (name.contains("google") || name.contains("microsoft")) score += 4;
                        if (name.contains("compact") || name.contains("basic")) score -= 3;
                        if (score > bestScore) { bestScore = score; best = v; }
                    }
                    if (best != null) tts.setVoice(best);
                }
            } catch (Exception ignored) { /* voice seçimi dəstəklənmir */ }
            tts.setSpeechRate(pendingRate);
            tts.setPitch(pendingPitch);
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override
                public void onStart(String utteranceId) {
                }

                @Override
                public void onDone(String utteranceId) {
                    emit("speakEnd", "");
                }

                @Override
                public void onError(String utteranceId) {
                    emit("speakEnd", "");
                }
            });
            ttsReady = true;
            if (pendingSpeech != null) {
                String text = pendingSpeech;
                pendingSpeech = null;
                tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "jarvis-" + System.currentTimeMillis());
            }
        });
    }

    /* ---------------- fənər ---------------- */

    private boolean setTorch(boolean on) {
        try {
            if (torchCameraId == null) torchCameraId = findTorchCamera();
            if (torchCameraId == null) return false;
            cameraManager.setTorchMode(torchCameraId, on);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private String findTorchCamera() {
        try {
            for (String id : cameraManager.getCameraIdList()) {
                CameraCharacteristics c = cameraManager.getCameraCharacteristics(id);
                Boolean flash = c.get(CameraCharacteristics.FLASH_INFO_AVAILABLE);
                Integer facing = c.get(CameraCharacteristics.LENS_FACING);
                boolean isBack = facing != null && facing == CameraCharacteristics.LENS_FACING_BACK;
                if (Boolean.TRUE.equals(flash) && isBack) return id;
            }
            for (String id : cameraManager.getCameraIdList()) {
                CameraCharacteristics c = cameraManager.getCameraCharacteristics(id);
                if (Boolean.TRUE.equals(c.get(CameraCharacteristics.FLASH_INFO_AVAILABLE))) return id;
            }
        } catch (Exception ignored) {
            /* kamera yoxdur */
        }
        return null;
    }

    /* ---------------- JS-ə hadisə göndərmə ---------------- */

    private void emit(String type, String payload) {
        if (web == null) return;
        String functionName = "on" + Character.toUpperCase(type.charAt(0)) + type.substring(1);
        String arg = payload == null ? "\"\"" : JSONObject.quote(payload);
        final String js = "window.__jarvisNative && window.__jarvisNative." + functionName + "(" + arg + ");";
        web.post(() -> {
            try {
                web.evaluateJavascript(js, null);
            } catch (Exception ignored) {
                /* səhifə hazır deyil */
            }
        });
    }

    /* ---------------- həyat dövrü ---------------- */

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE) {
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                results = new Uri[]{data.getData()};
            }
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(results);
                filePathCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (web != null && web.canGoBack()) {
                web.goBack();
                return true;
            }
            moveTaskToBack(true);
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Arxa planda isəyən service-i dayandırırıq və lokal oyanma sözünü bərpa edirik.
        JarvisWakeService.setWakeEnabled(this, false);
        try {
            SharedPreferences sp = getSharedPreferences("jarvis", MODE_PRIVATE);
            if (sp.getBoolean("wakeTriggered", false)) {
                sp.edit().putBoolean("wakeTriggered", false).apply();
                emit("wake", "");
            }
        } catch (Exception ignored) {}
        if (wakeEnabled && !wakeRunning) {
            wakeRunning = true;
            startRecognition(true);
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (tts != null) tts.stop();
        // Oyanma sözü aktivdirsə, arxa planda service ilə davam etsin.
        if (wakeEnabled) {
            JarvisWakeService.setWakeEnabled(this, true);
        }
        wakeRunning = false;
        destroyRecognizer();
    }

    @Override
    protected void onDestroy() {
        wakeRunning = false;
        destroyRecognizer();
        if (tts != null) {
            try {
                tts.stop();
                tts.shutdown();
            } catch (Exception ignored) {
                /* bağlanıb */
            }
        }
        if (web != null) {
            try {
                web.destroy();
            } catch (Exception ignored) {
                /* bağlanıb */
            }
        }
        super.onDestroy();
    }
}
