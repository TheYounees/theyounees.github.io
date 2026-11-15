package az.jarvis.app;

import java.util.Locale;

/** Tətbiq adlarını səslə/yazılışla uyğunlaşdıran köməkçi (Android-dən asılı deyil). */
public final class AppMatch {

    private AppMatch() {}

    public static String normalize(String s) {
        if (s == null) return "";
        String lower = s.toLowerCase(new Locale("az"));
        lower = lower.replace('ə', 'e').replace('ı', 'i').replace('ö', 'o').replace('ü', 'u')
                .replace('ş', 's').replace('ç', 'c').replace('ğ', 'g').replace('ñ', 'n');
        StringBuilder b = new StringBuilder();
        boolean space = true;
        for (int i = 0; i < lower.length(); i++) {
            char c = lower.charAt(i);
            if (Character.isLetterOrDigit(c)) {
                b.append(c);
                space = false;
            } else if (!space) {
                b.append(' ');
                space = true;
            }
        }
        return b.toString().trim();
    }

    /** Səslə yazılışı sadələşdirir: whatsapp → vatsap, phone → fone. */
    public static String phonetic(String s) {
        String n = normalize(s).replace("ph", "f").replace("w", "v").replace("h", "");
        StringBuilder b = new StringBuilder();
        char last = 0;
        for (int i = 0; i < n.length(); i++) {
            char c = n.charAt(i);
            if (c != last) b.append(c);
            last = c;
        }
        return b.toString();
    }

    /** Bilinən tətbiq adları üçün birbaşa paketlər. */
    public static String alias(String key) {
        if (key == null) return null;
        String k = key.toLowerCase(new Locale("az")).trim();
        for (String[] pair : ALIASES) {
            if (pair[0].equals(k)) return pair[1];
        }
        return null;
    }

    private static final String[][] ALIASES = {
        {"whatsapp", "com.whatsapp"}, {"vatsap", "com.whatsapp"}, {"whats app", "com.whatsapp"},
        {"whatsapp business", "com.whatsapp.w4b"},
        {"pubg", "com.tencent.ig"}, {"pubg mobile", "com.tencent.ig"},
        {"waze", "com.waze"}, {"veys", "com.waze"},
        {"yandex", "ru.yandex.yandexnavi"}, {"yandex navi", "ru.yandex.yandexnavi"},
        {"youtube", "com.google.android.youtube"},
        {"spotify", "com.spotify.music"}, {"musiqi", "com.spotify.music"}, {"musiq", "com.spotify.music"},
        {"music", "com.spotify.music"},
        {"telegram", "org.telegram.messenger"},
        {"instagram", "com.instagram.android"}, {"insta", "com.instagram.android"},
        {"tiktok", "com.zhiliaoapp.musically"},
        {"facebook", "com.facebook.katana"},
        {"maps", "com.google.android.apps.maps"}, {"xəritə", "com.google.android.apps.maps"},
        {"google maps", "com.google.android.apps.maps"}, {"google xəritə", "com.google.android.apps.maps"},
        {"google xerite", "com.google.android.apps.maps"}, {"xəritələr", "com.google.android.apps.maps"},
        {"xeriteler", "com.google.android.apps.maps"}, {"xəritələrdə", "com.google.android.apps.maps"},
        {"xerite", "com.google.android.apps.maps"},
        {"chrome", "com.android.chrome"},
        {"camera", "com.android.camera"}, {"kamera", "com.android.camera"},
        {"settings", "com.android.settings"}, {"ayarlar", "com.android.settings"},
        {"gmail", "com.google.android.gm"},
        {"phone", "com.android.dialer"}, {"zəng", "com.android.dialer"},
        {"messages", "com.google.android.apps.messaging"}, {"sms", "com.google.android.apps.messaging"},
        {"viber", "com.viber.voip"},
        {"signal", "org.thoughtcrime.securesms"},
        {"discord", "com.discord"},
        {"netflix", "com.netflix.mediaclient"},
        {"calculator", "com.google.android.calculator"}, {"kalkulyator", "com.google.android.calculator"},
        {"gallery", "com.google.android.apps.photos"}, {"qalereya", "com.google.android.apps.photos"},
        {"files", "com.google.android.documentsui"}, {"fayllar", "com.google.android.documentsui"},
        {"play store", "com.android.vending"}, {"play market", "com.android.vending"}
    };

    public static int levenshtein(String a, String b) {
        int n = a.length(), m = b.length();
        if (n == 0) return m;
        if (m == 0) return n;
        int[] prev = new int[m + 1];
        int[] cur = new int[m + 1];
        for (int j = 0; j <= m; j++) prev[j] = j;
        for (int i = 1; i <= n; i++) {
            cur[0] = i;
            for (int j = 1; j <= m; j++) {
                int cost = a.charAt(i - 1) == b.charAt(j - 1) ? 0 : 1;
                cur[j] = Math.min(Math.min(cur[j - 1] + 1, prev[j] + 1), prev[j - 1] + cost);
            }
            int[] tmp = prev; prev = cur; cur = tmp;
        }
        return prev[m];
    }

    private static boolean tokensPrefix(String label, String query) {
        String[] q = query.split(" ");
        String[] l = label.split(" ");
        if (q.length == 0 || q.length > l.length) return false;
        for (int i = 0; i < q.length; i++) {
            if (!l[i].equals(q[i]) && !l[i].startsWith(q[i])) return false;
        }
        return true;
    }

    private static boolean allTokens(String label, String query) {
        for (String t : query.split(" ")) {
            if (t.length() < 2) continue;
            boolean found = false;
            for (String lt : label.split(" ")) {
                if (lt.equals(t) || lt.startsWith(t)) { found = true; break; }
            }
            if (!found) return false;
        }
        return true;
    }

    /** 0 = uyğun deyil. Yüksək bal daha yaxşı uyğunluq. */
    public static int score(String query, String label, String pkg) {
        String q = normalize(query);
        String l = normalize(label);
        String p = normalize(pkg);
        if (q.isEmpty() || l.isEmpty()) return 0;
        if (q.equals(l)) return 1000;
        if (p.equals(q)) return 990;
        String qp = phonetic(query);
        String lp = phonetic(label);
        if (!qp.isEmpty() && qp.equals(lp)) return 950;
        if (l.startsWith(q)) return 900 - Math.min(90, l.length() - q.length());
        if (p.endsWith(" " + q) || p.contains(q)) return 820;
        if (tokensPrefix(l, q)) return 780;
        if (l.contains(q)) return 700 - Math.min(120, l.indexOf(q) * 3);
        if (allTokens(l, q)) return 650;
        if (!qp.isEmpty() && !lp.isEmpty()) {
            double ps = 1.0 - (double) levenshtein(qp, lp) / Math.max(qp.length(), lp.length());
            if (ps >= 0.85) return (int) (640 * ps);
        }
        double sim = 1.0 - (double) levenshtein(q, l) / Math.max(q.length(), l.length());
        if (sim >= 0.70) return (int) (620 * sim);
        String first = l.split(" ")[0];
        double sim2 = 1.0 - (double) levenshtein(q, first) / Math.max(q.length(), first.length());
        if (sim2 >= 0.72) return (int) (560 * sim2);
        return 0;
    }

    /** Ən yaxşı uyğun indeksi, yoxsa -1. */
    public static int pick(String query, String[] labels, String[] packages) {
        int best = -1;
        int bestScore = 480;
        for (int i = 0; i < labels.length && i < packages.length; i++) {
            int s = score(query, labels[i], packages[i]);
            if (s > bestScore) { bestScore = s; best = i; }
        }
        return best;
    }
}
