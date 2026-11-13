package az.jarvis.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.util.Log;

import java.util.ArrayList;
import java.util.Locale;

public class JarvisWakeService extends Service {

    private static final String TAG = "JarvisWake";
    private static final String CHANNEL_ID = "jarvis_wake";
    private static final int NOTIF_ID = 42;
    private static final String PREFS = "jarvis";

    private SpeechRecognizer recognizer;
    private boolean running = false;
    private String lang = "az-AZ";
    private boolean fallbackTried = false;

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && "stop".equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        running = true;
        startForeground(NOTIF_ID, buildNotification());
        startRecognition();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        destroyRecognizer();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "JARVIS oyanma", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Arxa planda 'Jarvis' oyanma sozunu dinlayir.");
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    private Notification buildNotification() {
        Intent launch = new Intent(this, MainActivity.class);
        launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, launch,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        b.setContentTitle("JARVIS")
         .setContentText("'Jarvis' deyin — dinləyirəm")
         .setSmallIcon(android.R.drawable.ic_btn_speak_now)
         .setContentIntent(pi)
         .setOngoing(true);
        return b.build();
    }

    private void startRecognition() {
        if (!running) return;
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            Log.w(TAG, "Recognition not available");
            scheduleRestart(2000);
            return;
        }
        destroyRecognizer();
        recognizer = SpeechRecognizer.createSpeechRecognizer(this);
        recognizer.setRecognitionListener(new RecognitionListener() {
            @Override public void onReadyForSpeech(Bundle params) {}
            @Override public void onBeginningOfSpeech() {}
            @Override public void onRmsChanged(float rmsdB) {}
            @Override public void onBufferReceived(byte[] buffer) {}
            @Override public void onEndOfSpeech() {}
            @Override public void onError(int error) {
                if (error == SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED
                        || error == SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE) {
                    if (!fallbackTried) {
                        fallbackTried = true;
                        lang = "tr-TR";
                        scheduleRestart(300);
                        return;
                    }
                }
                scheduleRestart(800);
            }
            @Override public void onResults(Bundle results) {
                ArrayList<String> list = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                String text = (list != null && !list.isEmpty()) ? list.get(0) : "";
                String lower = text.toLowerCase(new Locale("az"));
                if (lower.contains("jarvis") || lower.contains("carvis") || lower.contains("jarviz")
                        || lower.contains("çarvis")) {
                    launchApp();
                } else {
                    scheduleRestart(200);
                }
            }
            @Override public void onPartialResults(Bundle partialResults) {
                ArrayList<String> list = partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                if (list != null && !list.isEmpty()) {
                    String lower = list.get(0).toLowerCase(new Locale("az"));
                    if (lower.contains("jarvis") || lower.contains("carvis") || lower.contains("jarviz")) {
                        launchApp();
                    }
                }
            }
            @Override public void onEvent(int eventType, Bundle params) {}
        });

        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, lang);
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getPackageName());

        try {
            recognizer.startListening(intent);
        } catch (Exception e) {
            scheduleRestart(1500);
        }
    }

    private void launchApp() {
        SharedPreferences sp = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        sp.edit().putBoolean("wakeTriggered", true).apply();
        Intent launch = new Intent(this, MainActivity.class);
        launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        launch.putExtra("wake", true);
        startActivity(launch);
        // keep service running for next wake
        scheduleRestart(1500);
    }

    private void scheduleRestart(long delayMs) {
        if (!running) return;
        android.os.Handler h = new android.os.Handler(getMainLooper());
        h.postDelayed(this::startRecognition, delayMs);
    }

    private void destroyRecognizer() {
        if (recognizer != null) {
            try { recognizer.cancel(); recognizer.destroy(); } catch (Exception ignored) {}
            recognizer = null;
        }
    }

    public static void setWakeEnabled(Context ctx, boolean enabled) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("wakeEnabled", enabled).apply();
        if (enabled) {
            Intent i = new Intent(ctx, JarvisWakeService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i);
            else ctx.startService(i);
        } else {
            ctx.stopService(new Intent(ctx, JarvisWakeService.class));
        }
    }

    public static boolean isWakeEnabled(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("wakeEnabled", false);
    }
}