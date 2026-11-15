package az.jarvis.app;

import java.net.URLEncoder;

/** Naviqasiya proqramları üçün düzgün deep link-lər (Android-dən asılı deyil, test edilə bilir). */
public final class NavLinks {

    private NavLinks() {}

    public static String encode(String s) {
        try {
            return URLEncoder.encode(s == null ? "" : s.trim(), "UTF-8").replace("+", "%20");
        } catch (Exception e) {
            return "";
        }
    }

    /** Waze rəsmi universal link formatı. */
    public static String waze(String dest) {
        return "https://waze.com/ul?q=" + encode(dest) + "&navigate=yes";
    }

    public static String google(String dest) {
        return "google.navigation:q=" + encode(dest);
    }

    public static String googleWeb(String dest) {
        return "https://www.google.com/maps/dir/?api=1&destination=" + encode(dest);
    }

    public static String yandex(String dest) {
        return "yandexnavi://build_route_on_map?to=" + encode(dest);
    }

    public static String yandexWeb(String dest) {
        return "https://yandex.com/maps/?text=" + encode(dest);
    }

    public static String geo(String dest) {
        return "geo:0,0?q=" + encode(dest);
    }

    /** {uri, paket} — paket boşdursa sistem özü seçir. */
    public static String[] resolve(String app, String dest) {
        String a = app == null ? "" : app.toLowerCase().trim();
        if (a.contains("waze") || a.contains("veys")) {
            return new String[]{waze(dest), "com.waze"};
        }
        if (a.contains("yandex")) {
            return new String[]{yandex(dest), "ru.yandex.yandexnavi"};
        }
        return new String[]{google(dest), "com.google.android.apps.maps"};
    }
}
