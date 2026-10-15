package com.cinematrack.share;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.*;
import android.widget.*;
import androidx.appcompat.app.AppCompatActivity;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import java.util.*;
import java.util.concurrent.*;
import okhttp3.OkHttpClient;

/** Search TMDB for a movie (CinemaTrack) or a series (DiziTrack) and add it to the list. */
public class SearchActivity extends AppCompatActivity implements MovieDetailSheet.OnActionListener {

    private MediaKind kind = MediaKind.MOVIE;
    private ImageButton btnSearch;
    private EditText etSearch;
    private ListView lvResults;
    private ProgressBar progressBar;
    private TextView tvHint;
    private final List<Map<String, Object>> results = new ArrayList<>();
    private final ExecutorService executor = Executors.newFixedThreadPool(2);
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final OkHttpClient http = new OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).build();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        kind = MediaKind.fromKey(getIntent().getStringExtra("kind"));
        setTheme(UiTheme.themeRes(kind));          // purple for series, before anything is inflated
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_search);

        etSearch    = findViewById(R.id.etSearch);
        btnSearch   = findViewById(R.id.btnSearch);
        lvResults   = findViewById(R.id.lvResults);
        progressBar = findViewById(R.id.progressBar);
        tvHint      = findViewById(R.id.tvHint);

        ((TextView) findViewById(R.id.tvSearchTitle)).setText(kind.isTv() ? R.string.search_title_tv : R.string.search_title);
        etSearch.setHint(kind.isTv() ? R.string.search_hint_tv : R.string.search_hint);
        tvHint.setText(kind.isTv() ? R.string.search_idle_tv : R.string.search_idle);

        lvResults.setDescendantFocusability(ListView.FOCUS_BLOCK_DESCENDANTS);

        btnSearch.setOnClickListener(v -> doSearch());
        etSearch.setOnEditorActionListener((v, actionId, event) -> { doSearch(); return true; });

        lvResults.setOnItemClickListener((parent, view, pos, id) -> {
            if (pos >= results.size()) return;
            Map<String, Object> movie = results.get(pos);
            MovieDetailSheet sheet = MovieDetailSheet.newInstance(movie, "search", kind);
            sheet.setOnActionListener(this);
            sheet.show(getSupportFragmentManager(), "detail");
        });
    }

    private void doSearch() {
        String query = etSearch.getText().toString().trim();
        if (query.isEmpty()) return;
        progressBar.setVisibility(View.VISIBLE);
        tvHint.setVisibility(View.GONE);
        results.clear();
        if (lvResults.getAdapter() != null) ((BaseAdapter) lvResults.getAdapter()).notifyDataSetChanged();

        final String lang = Lang.tmdb();
        executor.execute(() -> {
            try {
                List<Map<String, Object>> found = Tmdb.search(http, kind, query, lang, 15);
                handler.post(() -> {
                    results.addAll(found);
                    progressBar.setVisibility(View.GONE);
                    if (results.isEmpty()) {
                        tvHint.setText(getString(R.string.no_results, query));
                        tvHint.setVisibility(View.VISIBLE);
                    } else {
                        lvResults.setAdapter(new SearchAdapter());
                    }
                });
            } catch (Exception e) {
                handler.post(() -> {
                    progressBar.setVisibility(View.GONE);
                    Toast.makeText(this, getString(R.string.search_failed, e.getMessage()), Toast.LENGTH_SHORT).show();
                });
            }
        });
    }

    // MovieDetailSheet callbacks
    @Override
    public void onMarkWatched(Map<String, Object> movie) {
        View dv = LayoutInflater.from(this).inflate(R.layout.dialog_watched, null);
        RatingBar rb = dv.findViewById(R.id.ratingBar);
        EditText et = dv.findViewById(R.id.etNotes);
        new android.app.AlertDialog.Builder(this)
            .setTitle(R.string.rate_and_log)
            .setView(dv)
            .setPositiveButton(R.string.confirm, (d, w) -> {
                int rating = Math.round(rb.getRating() * 2); // 0.5-5 stars → 1-10
                String notes = et.getText().toString().trim();
                logWatched(movie, rating > 0 ? rating : null, notes.isEmpty() ? null : notes);
            })
            .setNegativeButton(R.string.cancel, null).show();
    }

    private void logWatched(Map<String, Object> movie, Integer rating, String notes) {
        FirebaseUser user = FirebaseAuth.getInstance().getCurrentUser();
        if (user == null) return;
        executor.execute(() -> {
            try {
                Object tmdbId = movie.get("tmdb_id");
                if (tmdbId == null) return;
                Map<String, Object> fullMovie = Tmdb.details(http, kind, ((Number) tmdbId).intValue());
                String today = new java.text.SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
                Map<String, Object> entry = new HashMap<>(fullMovie);
                entry.put("watched_at", today);
                entry.put("rating", rating);
                entry.put("notes", notes);
                FirestoreHelper.addWatchLog(user.getUid(), kind, entry)
                    .addOnSuccessListener(v -> handler.post(() ->
                        Toast.makeText(this, R.string.toast_marked_watched, Toast.LENGTH_SHORT).show()));
            } catch (Exception e) {
                handler.post(() -> Toast.makeText(this, getString(R.string.error_with_message, e.getMessage()), Toast.LENGTH_SHORT).show());
            }
        });
    }

    @Override
    public void onAdd(Map<String, Object> movie) {
        FirebaseUser user = FirebaseAuth.getInstance().getCurrentUser();
        if (user == null) { Toast.makeText(this, R.string.please_log_in, Toast.LENGTH_SHORT).show(); return; }

        Toast.makeText(this, R.string.fetching_details, Toast.LENGTH_SHORT).show();

        executor.execute(() -> {
            try {
                Object tmdbId = movie.get("tmdb_id");
                if (tmdbId == null) return;
                Map<String, Object> fullMovie = Tmdb.details(http, kind, ((Number) tmdbId).intValue());

                FirestoreHelper.addToWatchlist(user.getUid(), kind, fullMovie)
                    .addOnSuccessListener(v -> handler.post(() ->
                        Toast.makeText(this, getString(R.string.added_toast, Tmdb.title(fullMovie, Lang.isTurkish())), Toast.LENGTH_LONG).show()))
                    .addOnFailureListener(e -> handler.post(() ->
                        Toast.makeText(this, getString(R.string.failed_with_message, e.getMessage()), Toast.LENGTH_SHORT).show()));
            } catch (Exception e) {
                handler.post(() -> Toast.makeText(this, getString(R.string.error_with_message, e.getMessage()), Toast.LENGTH_SHORT).show());
            }
        });
    }

    @Override public void onRemove(Map<String, Object> movie) {}

    class SearchAdapter extends BaseAdapter {
        @Override public int getCount() { return results.size(); }
        @Override public Object getItem(int pos) { return results.get(pos); }
        @Override public long getItemId(int pos) { return pos; }

        @Override
        public View getView(int pos, View cv, ViewGroup parent) {
            if (cv == null) cv = LayoutInflater.from(SearchActivity.this).inflate(R.layout.item_movie, parent, false);
            Map<String, Object> m = results.get(pos);

            ((TextView) cv.findViewById(R.id.tvTitle)).setText(String.valueOf(m.getOrDefault("title", "")));

            String date = String.valueOf(m.getOrDefault("release_date", ""));
            ((TextView) cv.findViewById(R.id.tvYear)).setText(date.length() >= 4 ? date.substring(0, 4) : "");

            ((TextView) cv.findViewById(R.id.tvGenre)).setText("");
            ((TextView) cv.findViewById(R.id.tvOverview)).setText(String.valueOf(m.getOrDefault("overview", "")));

            Object rating = m.get("vote_average");
            TextView tvBadge = cv.findViewById(R.id.tvRatingBadge);
            LinearLayout layoutRating = cv.findViewById(R.id.layoutRating);
            if (rating != null && ((Number) rating).doubleValue() > 0) {
                tvBadge.setText(String.format(Locale.getDefault(), "%.1f", ((Number) rating).doubleValue()));
                layoutRating.setVisibility(View.VISIBLE);
            } else layoutRating.setVisibility(View.GONE);

            String poster = (String) m.get("poster_path");
            ImageView iv = cv.findViewById(R.id.ivPoster);
            if (poster != null && !poster.isEmpty() && !poster.equals("null")) {
                com.bumptech.glide.Glide.with(SearchActivity.this)
                    .load("https://image.tmdb.org/t/p/w92" + poster)
                    .placeholder(R.drawable.poster_placeholder)
                    .into(iv);
            } else iv.setImageResource(R.drawable.ic_movie);
            return cv;
        }
    }

    @Override protected void onDestroy() { super.onDestroy(); executor.shutdown(); }
}
