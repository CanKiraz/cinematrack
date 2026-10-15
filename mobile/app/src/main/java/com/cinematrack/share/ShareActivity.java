package com.cinematrack.share;

import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.Html;
import android.view.View;
import android.widget.*;
import androidx.appcompat.app.AppCompatActivity;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.IOException;
import java.util.*;
import java.util.concurrent.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import okhttp3.*;

/** "Share to CinemaTrack" from Instagram: finds the movie or series in the reel and adds it to the right list. */
public class ShareActivity extends AppCompatActivity {

    // RapidAPI "Post Info" (fallback when the page itself gives no caption): GET /api/v1/posts/info?code=<shortcode>
    // (the old "/v1/post_info?url=" path no longer exists on this host and returned 404)
    private static final String RAPID_PATH = "/api/v1/posts/info?code=";
    private static final Pattern POST_CODE = Pattern.compile(
        "instagram\\.com/(?:[^/?#]+/)?(?:reels?|p|tv)/([A-Za-z0-9_-]+)", Pattern.CASE_INSENSITIVE);
    // Instagram only serves og: meta tags (which contain the caption) to link-preview crawlers.
    private static final String CRAWLER_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

    private LinearLayout layoutSearch, layoutResults;
    private EditText etSearch;
    private androidx.appcompat.widget.AppCompatButton btnSearch, btnCancel;
    private ProgressBar progressBar;
    private TextView tvStatus;
    private ListView lvResults;

    private final List<Map<String, Object>> movieResults = new ArrayList<>();
    // Cached thread pool — unlimited threads, no blocking
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final OkHttpClient http = new OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build();
    // Gemini may retry on 503, so it gets a longer read timeout
    private final OkHttpClient geminiHttp = http.newBuilder().readTimeout(30, TimeUnit.SECONDS).build();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        FirebaseUser user = FirebaseAuth.getInstance().getCurrentUser();
        if (!LoginActivity.isReady(user)) {   // not signed in, or the email is not verified yet
            startActivity(new Intent(this, LoginActivity.class));
            finish();
            return;
        }

        setContentView(R.layout.activity_share);
        layoutSearch  = findViewById(R.id.layoutSearch);
        layoutResults = findViewById(R.id.layoutResults);
        etSearch      = findViewById(R.id.etSearch);
        btnSearch     = (androidx.appcompat.widget.AppCompatButton) findViewById(R.id.btnSearch);
        progressBar   = findViewById(R.id.progressBar);
        tvStatus      = findViewById(R.id.tvStatus);
        lvResults     = findViewById(R.id.lvResults);
        btnCancel     = (androidx.appcompat.widget.AppCompatButton) findViewById(R.id.btnCancel);

        lvResults.setDescendantFocusability(ListView.FOCUS_BLOCK_DESCENDANTS);
        btnCancel.setOnClickListener(v -> finish());
        btnSearch.setOnClickListener(v -> {
            String q = etSearch.getText().toString().trim();
            if (!q.isEmpty()) searchMovies(q);
        });
        etSearch.setOnEditorActionListener((v, actionId, event) -> {
            String q = etSearch.getText().toString().trim();
            if (!q.isEmpty()) searchMovies(q);
            return true;
        });

        String sharedText = "";
        if (Intent.ACTION_SEND.equals(getIntent().getAction())) {
            sharedText = getIntent().getStringExtra(Intent.EXTRA_TEXT);
        }

        // Always show search box right away
        showSearch(getString(R.string.share_search_prompt));

        // Try to identify from caption in background (doesn't block UI)
        if (sharedText != null && !sharedText.isEmpty()) {
            tvStatus.setText(R.string.share_identifying);
            progressBar.setVisibility(View.VISIBLE);
            tryIdentifyInBackground(sharedText);
        }
    }

    // ── Background identification (non-blocking) ──────────────────────────────

    private void tryIdentifyInBackground(String sharedText) {
        final String reelUrl = extractInstagramUrl(sharedText);
        final String lang = Lang.tmdb();

        executor.submit(() -> {
            String caption = fetchCaption(reelUrl);

            if (caption.isEmpty()) {
                handler.post(() -> {
                    progressBar.setVisibility(View.GONE);
                    tvStatus.setText(R.string.share_no_caption);
                });
                return;
            }

            handler.post(() -> tvStatus.setText(R.string.share_caption_found));

            try {
                String prompt = "What movie or TV series is this Instagram reel about?\n\n"
                    + "Caption: " + caption + "\n\n"
                    + "Give your top 3 guesses as a JSON array of exact titles. "
                    + "Reply ONLY with: [\"Title 1\", \"Title 2\", \"Title 3\"] "
                    + "or [\"UNKNOWN\"] if you can't tell.";

                String geminiResp = GeminiClient.generate(geminiHttp, prompt, 256, 0.2, false);
                JSONArray titles = parseTitles(geminiResp);

                List<Map<String, Object>> movies = new ArrayList<>();
                Set<String> seen = new HashSet<>();
                for (int i = 0; i < Math.min(titles.length(), 3); i++) {
                    String title = titles.getString(i);
                    if (title.equalsIgnoreCase("UNKNOWN")) continue;
                    List<Map<String, Object>> hits = Tmdb.searchMulti(http, title, lang, 1);
                    if (hits.isEmpty()) continue;
                    Map<String, Object> m = hits.get(0);
                    if (seen.add(m.get("media_kind") + ":" + m.get("tmdb_id"))) movies.add(m);
                }

                handler.post(() -> {
                    progressBar.setVisibility(View.GONE);
                    if (!movies.isEmpty()) {
                        tvStatus.setText(R.string.share_matches);
                        showResults(movies);
                    } else {
                        tvStatus.setText(R.string.share_unknown);
                    }
                });
            } catch (Exception e) {
                handler.post(() -> {
                    progressBar.setVisibility(View.GONE);
                    tvStatus.setText(getString(R.string.share_identify_failed, shortMessage(e)));
                });
            }
        });
    }

    /** Page first (free, no quota), RapidAPI second. Never throws — empty string means "not found". */
    private String fetchCaption(String reelUrl) {
        String caption = fetchCaptionFromPage(reelUrl);
        if (!caption.isEmpty()) return caption;
        return fetchCaptionFromRapidApi(reelUrl);
    }

    private String fetchCaptionFromPage(String reelUrl) {
        try {
            HttpUrl parsed = HttpUrl.parse(reelUrl);
            if (parsed == null) return "";
            Request req = new Request.Builder()
                .url(parsed.newBuilder().query(null).build())   // drop tracking params like ?igsh=
                .header("User-Agent", CRAWLER_UA)
                .header("Accept-Language", "en-US,en;q=0.9")
                .build();
            try (Response resp = http.newCall(req).execute()) {
                ResponseBody body = resp.body();
                if (!resp.isSuccessful() || body == null) return "";
                String html = body.string();
                String desc = metaContent(html, "og:description");
                return desc.isEmpty() ? metaContent(html, "og:title") : desc;
            }
        } catch (Exception e) {
            return "";
        }
    }

    private String fetchCaptionFromRapidApi(String reelUrl) {
        try {
            Matcher code = POST_CODE.matcher(reelUrl);
            if (!code.find()) return "";
            Request req = new Request.Builder()
                .url("https://" + FirestoreHelper.RAPID_HOST + RAPID_PATH + code.group(1))
                .addHeader("x-rapidapi-key", FirestoreHelper.RAPID_KEY)
                .addHeader("x-rapidapi-host", FirestoreHelper.RAPID_HOST)
                .build();
            try (Response resp = http.newCall(req).execute()) {
                ResponseBody body = resp.body();
                if (!resp.isSuccessful() || body == null) return "";
                JSONObject data = new JSONObject(body.string()).optJSONObject("data");
                if (data == null) return "";
                JSONObject cap = data.optJSONObject("caption");
                return cap == null ? "" : cap.optString("text", "");
            }
        } catch (Exception e) {
            return "";
        }
    }

    private static final Pattern META_TAG = Pattern.compile("<meta\\s[^>]*>", Pattern.CASE_INSENSITIVE);
    private static final Pattern CONTENT_ATTR = Pattern.compile("content=\"([^\"]*)\"", Pattern.CASE_INSENSITIVE);

    private String metaContent(String html, String property) {
        Matcher tags = META_TAG.matcher(html);
        while (tags.find()) {
            String tag = tags.group();
            if (!tag.toLowerCase(Locale.ROOT).contains("property=\"" + property + "\"")) continue;
            Matcher c = CONTENT_ATTR.matcher(tag);
            if (c.find()) return Html.fromHtml(c.group(1), Html.FROM_HTML_MODE_LEGACY).toString().trim();
        }
        return "";
    }

    private JSONArray parseTitles(String geminiResp) throws Exception {
        int start = geminiResp.indexOf('[');
        int end = geminiResp.lastIndexOf(']');
        if (start < 0 || end <= start) throw new IOException("unexpected answer");
        return new JSONArray(geminiResp.substring(start, end + 1));
    }

    private String shortMessage(Exception e) {
        String m = e.getMessage();
        if (m == null || m.isEmpty()) return e.getClass().getSimpleName();
        return m.length() > 80 ? m.substring(0, 80) + "…" : m;
    }

    // ── Show options ──────────────────────────────────────────────────────────

    private void showResults(List<Map<String, Object>> movies) {
        movieResults.clear();
        movieResults.addAll(movies);
        layoutResults.setVisibility(View.VISIBLE);

        List<String> labels = new ArrayList<>();
        for (Map<String, Object> m : movies) {
            String icon = "tv".equals(m.get("media_kind")) ? "📺 " : "🎬 ";
            String title = String.valueOf(m.getOrDefault("title", ""));
            String date  = String.valueOf(m.getOrDefault("release_date", ""));
            String year  = date.length() >= 4 ? date.substring(0, 4) : "";
            double r     = m.get("vote_average") != null ? ((Number) m.get("vote_average")).doubleValue() : 0;
            labels.add(icon + title + (year.isEmpty() ? "" : " (" + year + ")") +
                (r > 0 ? "  ★" + String.format(Locale.getDefault(), "%.1f", r) : ""));
        }
        labels.add(getString(R.string.share_none));

        lvResults.setAdapter(new ArrayAdapter<>(this, R.layout.list_item_movie, labels));
        lvResults.setOnItemClickListener((p, v, pos, id) -> {
            if (pos < movieResults.size()) addToWatchlist(movieResults.get(pos));
            else {
                layoutResults.setVisibility(View.GONE);
                etSearch.requestFocus();
            }
        });
    }

    private void showSearch(String hint) {
        tvStatus.setText(hint);
        layoutSearch.setVisibility(View.VISIBLE);
        layoutResults.setVisibility(View.GONE);
    }

    // ── Manual TMDB search (movies and series together) ───────────────────────

    private void searchMovies(String query) {
        progressBar.setVisibility(View.VISIBLE);
        tvStatus.setText(R.string.share_searching);
        layoutResults.setVisibility(View.GONE);
        final String lang = Lang.tmdb();

        executor.submit(() -> {
            try {
                List<Map<String, Object>> movies = Tmdb.searchMulti(http, query, lang, 8);
                handler.post(() -> {
                    progressBar.setVisibility(View.GONE);
                    if (movies.isEmpty()) {
                        tvStatus.setText(getString(R.string.no_results, query));
                    } else {
                        tvStatus.setText(R.string.share_tap_to_add);
                        showResults(movies);
                    }
                });
            } catch (Exception e) {
                handler.post(() -> {
                    progressBar.setVisibility(View.GONE);
                    tvStatus.setText(getString(R.string.search_failed, e.getMessage()));
                });
            }
        });
    }

    // ── Add chosen title straight to the right watchlist ──────────────────────
    // (Used to go through the "toAdd" queue, which only the desktop app consumed — and it never
    //  copied the movie to Firestore, so it never showed up on the phone.)

    private void addToWatchlist(Map<String, Object> movie) {
        FirebaseUser user = FirebaseAuth.getInstance().getCurrentUser();
        if (user == null) { finish(); return; }

        progressBar.setVisibility(View.VISIBLE);
        layoutResults.setVisibility(View.GONE);
        tvStatus.setText(R.string.share_adding);
        final MediaKind kind = MediaKind.fromKey(String.valueOf(movie.get("media_kind")));

        executor.submit(() -> {
            try {
                int tmdbId = ((Number) movie.get("tmdb_id")).intValue();
                Map<String, Object> data = Tmdb.details(http, kind, tmdbId);

                FirestoreHelper.addToWatchlist(user.getUid(), kind, data)
                    .addOnSuccessListener(v -> handler.post(() -> {
                        Toast.makeText(this, getString(R.string.added_toast, Tmdb.title(data, Lang.isTurkish())), Toast.LENGTH_LONG).show();
                        finish();
                    }))
                    .addOnFailureListener(e -> handler.post(() -> {
                        progressBar.setVisibility(View.GONE);
                        tvStatus.setText(getString(R.string.share_save_failed, e.getMessage()));
                    }));
            } catch (Exception e) {
                handler.post(() -> {
                    progressBar.setVisibility(View.GONE);
                    tvStatus.setText(getString(R.string.error_with_message, e.getMessage()));
                });
            }
        });
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private String extractInstagramUrl(String text) {
        if (text == null) return "";
        for (String word : text.split("\\s+")) {
            if (word.contains("instagram.com")) return word.trim();
        }
        return text.trim();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        executor.shutdownNow(); // Cancel pending tasks immediately
    }
}
