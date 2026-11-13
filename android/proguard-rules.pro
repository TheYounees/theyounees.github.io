# JARVIS R8 qaydaları
#
# Qeyd: bu layihə Gradle/AAPT istifadə etmir, ona görə R8 manifesti görmür.
# Activity və JS körpüsünün sinifləri mütləq saxlanmalıdır.

## JS körpüsü — @JavascriptInterface anotasiyalı metodlar silinə bilməz.
-keepattributes JavascriptInterface
-keepattributes *Annotation*
-keepattributes Signature,InnerClasses,EnclosingMethod

-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

## WebView native körpüsü (adlar dəyişməsin, metodlar silinməsin).
-keep class az.jarvis.app.MainActivity$Bridge {
    public *;
}
-keep class az.jarvis.app.MainActivity {
    <init>(...);
    *;
}

## Sistem tərəfindən yaradılan siniflər.
-keep class * extends android.app.Activity {
    <init>(...);
}
-keep class * extends android.webkit.WebViewClient { *; }
-keep class * extends android.webkit.WebChromeClient { *; }

## Android komponentləri üçün adlar qorunmalıdır.
-keepnames class az.jarvis.app.MainActivity
-keepnames class az.jarvis.app.MainActivity$Bridge

## Könüllü (telefonda olmaya bilən) API-lər üçün xəbərdarlıqları susdur.
-dontwarn android.webkit.**
-dontwarn android.speech.**
-dontwarn android.hardware.camera2.**

## Debug məlumatı artıq javac -g:none ilə silinir.
