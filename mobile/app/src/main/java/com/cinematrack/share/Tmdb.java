package com.cinematrack.share;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.IOException;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

/** All TMDB access in one place (blocking — call from a background thread). Works for movies and TV. */
public final class Tmdb {
    private Tmdb() {}

    /** `path` is the TMDB path ("/search/movie?query=..."): the CinemaTrack API adds the key and enforces the limits. */
    public static JSONObject get(OkHttpClient http, String path) throws Exception {
        return ApiClient.get(http, "/v1/tmdb" + path);
    }

    private static String enc(String s) throws Exception { return URLEncoder.encode(s, "UTF-8"); }

    // ── Search ────────────────────────────────────────────────────────────────

    /** Results are in the requested language (titles and overviews), but genres/runtime are not filled in. */
    public static List<Map<String, Object>> search(OkHttpClient http, MediaKind kind, String query,
                                                   String lang, int max) throws Exception {
        JSONObject json = get(http, "/search/" + kind.key + "?query=" + enc(query) + "&language=" + lang);
        List<Map<String, Object>> out = new ArrayList<>();
        JSONArray arr = json.optJSONArray("results");
        if (arr != null) {
            for (int i = 0; i < Math.min(arr.length(), max); i++) out.add(fromSearchResult(arr.getJSONObject(i), kind));
        }
        return out;
    }

    /** Movies and TV together (used by the Instagram share screen). */
    public static List<Map<String, Object>> searchMulti(OkHttpClient http, String query, String lang, int max) throws Exception {
        JSONObject json = get(http, "/search/multi?query=" + enc(query) + "&language=" + lang);
        List<Map<String, Object>> out = new ArrayList<>();
        JSONArray arr = json.optJSONArray("results");
        if (arr != null) {
            for (int i = 0; i < arr.length() && out.size() < max; i++) {
                JSONObject m = arr.getJSONObject(i);
                String type = m.optString("media_type");
                if (!type.equals("movie") && !type.equals("tv")) continue;   // skip people
                out.add(fromSearchResult(m, MediaKind.fromKey(type)));
            }
        }
        return out;
    }

    public static Map<String, Object> fromSearchResult(JSONObject m, MediaKind kind) {
        Map<String, Object> movie = new HashMap<>();
        movie.put("tmdb_id",      m.optInt("id"));
        movie.put("title",        m.optString(kind.titleField, ""));
        movie.put("overview",     m.optString("overview", ""));
        movie.put("poster_path",  m.isNull("poster_path") ? "" : m.optString("poster_path", ""));
        movie.put("release_date", m.optString(kind.dateField, ""));
        movie.put("vote_average", m.optDouble("vote_average", 0));
        movie.put("genres",       new ArrayList<String>());
        movie.put("runtime",      0);
        movie.put("media_kind",   kind.key);
        return movie;
    }

    // ── Details ───────────────────────────────────────────────────────────────

    /**
     * Full details in English plus the Turkish translation (title_tr / overview_tr), so the lists can be shown
     * in either language later without more requests.
     */
    public static Map<String, Object> details(OkHttpClient http, MediaKind kind, int id) throws Exception {
        JSONObject d = get(http, "/" + kind.key + "/" + id + "?language=en-US&append_to_response=translations");
        return fromDetail(d, kind);
    }

    public static Map<String, Object> fromDetail(JSONObject d, MediaKind kind) {
        JSONArray genresArr = d.optJSONArray("genres");
        List<String> genres = new ArrayList<>();
        if (genresArr != null) {
            for (int i = 0; i < genresArr.length(); i++) {
                JSONObject g = genresArr.optJSONObject(i);
                if (g != null) genres.add(g.optString("name"));
            }
        }
        Long runtime = null;
        if (kind == MediaKind.MOVIE) {
            if (!d.isNull("runtime") && d.optInt("runtime") > 0) runtime = (long) d.optInt("runtime");
        } else {
            JSONArray ep = d.optJSONArray("episode_run_time");
            if (ep != null && ep.length() > 0 && ep.optInt(0) > 0) runtime = (long) ep.optInt(0);
        }

        Map<String, Object> m = new HashMap<>();
        m.put("tmdb_id", d.optInt("id", d.optInt("tmdb_id", 0)));
        m.put("title", d.optString(kind.titleField, ""));
        m.put("overview", d.optString("overview", ""));
        m.put("poster_path", d.isNull("poster_path") ? null : d.optString("poster_path"));
        m.put("release_date", d.optString(kind.dateField, ""));
        m.put("vote_average", d.optDouble("vote_average", 0));
        m.put("genres", genres);
        m.put("runtime", runtime);

        JSONObject translations = d.optJSONObject("translations");
        if (translations != null) {
            m.put("title_tr", "");
            m.put("overview_tr", "");
            JSONArray list = translations.optJSONArray("translations");
            if (list != null) {
                for (int i = 0; i < list.length(); i++) {
                    JSONObject t = list.optJSONObject(i);
                    if (t != null && "tr".equals(t.optString("iso_639_1"))) {
                        JSONObject data = t.optJSONObject("data");
                        if (data != null) {
                            m.put("title_tr", data.optString(kind.titleField, ""));
                            m.put("overview_tr", data.optString("overview", ""));
                        }
                        break;
                    }
                }
            }
            m.put("tr_checked", true);   // looked it up once; empty = TMDB has no Turkish text
        }
        return m;
    }

    /** Streaming offers in Turkey, or null. Shape: { flatrate:[...], free:[...], rent:[...], buy:[...], link } */
    public static JSONObject providersTR(OkHttpClient http, MediaKind kind, int id) throws Exception {
        JSONObject json = get(http, "/" + kind.key + "/" + id + "/watch/providers");
        JSONObject results = json.optJSONObject("results");
        return results == null ? null : results.optJSONObject("TR");
    }

    // ── Display helpers ───────────────────────────────────────────────────────

    public static String title(Map<String, Object> m, boolean turkish) {
        if (turkish) {
            Object t = m.get("title_tr");
            if (t instanceof String && !((String) t).trim().isEmpty()) return (String) t;
        }
        Object en = m.get("title");
        return en == null ? "" : String.valueOf(en);
    }

    public static String overview(Map<String, Object> m, boolean turkish) {
        if (turkish) {
            Object t = m.get("overview_tr");
            if (t instanceof String && !((String) t).trim().isEmpty()) return (String) t;
        }
        Object en = m.get("overview");
        return en == null ? "" : String.valueOf(en);
    }

    private static final Map<String, String> GENRES_TR = new HashMap<>();
    static {
        String[][] g = {
            {"Action", "Aksiyon"}, {"Adventure", "Macera"}, {"Animation", "Animasyon"}, {"Comedy", "Komedi"},
            {"Crime", "Suç"}, {"Documentary", "Belgesel"}, {"Drama", "Dram"}, {"Family", "Aile"},
            {"Fantasy", "Fantastik"}, {"History", "Tarih"}, {"Horror", "Korku"}, {"Music", "Müzik"},
            {"Mystery", "Gizem"}, {"Romance", "Romantik"}, {"Science Fiction", "Bilim Kurgu"},
            {"TV Movie", "TV Filmi"}, {"Thriller", "Gerilim"}, {"War", "Savaş"}, {"Western", "Vahşi Batı"},
            {"Action & Adventure", "Aksiyon ve Macera"}, {"Kids", "Çocuk"}, {"News", "Haber"},
            {"Reality", "Gerçeklik"}, {"Sci-Fi & Fantasy", "Bilim Kurgu ve Fantastik"}, {"Soap", "Pembe Dizi"},
            {"Talk", "Sohbet"}, {"War & Politics", "Savaş ve Politika"}
        };
        for (String[] p : g) GENRES_TR.put(p[0], p[1]);
    }

    /** Genres are stored in English; this is only for showing them. */
    public static String genre(String english, boolean turkish) {
        if (!turkish) return english;
        String tr = GENRES_TR.get(english);
        return tr != null ? tr : english;
    }
}
