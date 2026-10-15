package com.cinematrack.share;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.*;
import android.widget.*;
import com.google.android.material.bottomsheet.BottomSheetDialogFragment;
import com.google.android.material.chip.ChipGroup;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.*;
import java.util.concurrent.*;
import okhttp3.OkHttpClient;

/** Detail pop-up for a movie or a series, including where it can be watched in Turkey. */
public class MovieDetailSheet extends BottomSheetDialogFragment {

    public interface OnActionListener {
        void onMarkWatched(Map<String, Object> movie);
        void onAdd(Map<String, Object> movie);
        void onRemove(Map<String, Object> movie);
    }

    private Map<String, Object> movie;
    private String mode;
    private MediaKind kind = MediaKind.MOVIE;
    private OnActionListener listener;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final OkHttpClient http = new OkHttpClient();

    // Pass movie data via Bundle fields to avoid JSON serialization of Lists
    public static MovieDetailSheet newInstance(Map<String, Object> movie, String mode, MediaKind kind) {
        MovieDetailSheet sheet = new MovieDetailSheet();
        Bundle b = new Bundle();
        b.putString("mode", mode);
        b.putString("kind", kind.key);
        b.putString("title",        String.valueOf(movie.getOrDefault("title", "")));
        b.putString("title_tr",     String.valueOf(movie.getOrDefault("title_tr", "")));
        b.putString("overview",     String.valueOf(movie.getOrDefault("overview", "")));
        b.putString("overview_tr",  String.valueOf(movie.getOrDefault("overview_tr", "")));
        b.putString("poster_path",  String.valueOf(movie.getOrDefault("poster_path", "")));
        b.putString("release_date", String.valueOf(movie.getOrDefault("release_date", "")));
        b.putInt("tmdb_id",         movie.get("tmdb_id") != null ? ((Number) movie.get("tmdb_id")).intValue() : 0);
        b.putDouble("vote_average", movie.get("vote_average") != null ? ((Number) movie.get("vote_average")).doubleValue() : 0);
        b.putInt("runtime",         movie.get("runtime") != null ? ((Number) movie.get("runtime")).intValue() : 0);
        List<?> genres = (List<?>) movie.get("genres");
        if (genres != null) {
            ArrayList<String> gl = new ArrayList<>();
            for (Object g : genres) gl.add(String.valueOf(g));
            b.putStringArrayList("genres", gl);
        }
        sheet.setArguments(b);
        sheet.movie = movie; // keep reference for callbacks
        return sheet;
    }

    public void setOnActionListener(OnActionListener l) { this.listener = l; }

    @Override
    public View onCreateView(LayoutInflater inflater, ViewGroup container, Bundle savedInstanceState) {
        return inflater.inflate(R.layout.sheet_movie_detail, container, false);
    }

    @Override
    public int getTheme() {
        Bundle a = getArguments();
        MediaKind k = a != null ? MediaKind.fromKey(a.getString("kind")) : MediaKind.MOVIE;
        return UiTheme.sheetThemeRes(k);
    }

    @Override
    public void onViewCreated(View view, Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);

        Bundle b = requireArguments();
        mode = b.getString("mode", "watchlist");
        kind = MediaKind.fromKey(b.getString("kind"));
        final boolean tr = Lang.isTurkish();

        // Rebuild movie map from bundle if lost (e.g. after rotation)
        if (movie == null) {
            movie = new HashMap<>();
            movie.put("tmdb_id",      b.getInt("tmdb_id"));
            movie.put("title",        b.getString("title", ""));
            movie.put("title_tr",     b.getString("title_tr", ""));
            movie.put("overview",     b.getString("overview", ""));
            movie.put("overview_tr",  b.getString("overview_tr", ""));
            movie.put("poster_path",  b.getString("poster_path", ""));
            movie.put("release_date", b.getString("release_date", ""));
            movie.put("vote_average", b.getDouble("vote_average"));
            movie.put("runtime",      b.getInt("runtime"));
            movie.put("genres",       b.getStringArrayList("genres"));
        }

        ImageView ivPoster   = view.findViewById(R.id.ivPoster);
        TextView tvTitle     = view.findViewById(R.id.tvTitle);
        TextView tvYear      = view.findViewById(R.id.tvYear);
        TextView tvRuntime   = view.findViewById(R.id.tvRuntime);
        TextView tvRating    = view.findViewById(R.id.tvRating);
        TextView tvGenres    = view.findViewById(R.id.tvGenres);
        TextView tvOverview  = view.findViewById(R.id.tvOverview);
        TextView tvStreaming = view.findViewById(R.id.tvStreamingStatus);
        ViewGroup llStreaming = view.findViewById(R.id.llStreaming);
        Button btnWatched    = view.findViewById(R.id.btnWatched);
        Button btnAdd        = view.findViewById(R.id.btnAdd);
        Button btnAddWatched = view.findViewById(R.id.btnAddWatched);
        Button btnRemove     = view.findViewById(R.id.btnRemove);

        final String shownTitle = Tmdb.title(movie, tr);
        tvTitle.setText(shownTitle);

        String date = b.getString("release_date", "");
        tvYear.setText(date.length() >= 4 ? date.substring(0, 4) : "");

        int runtime = b.getInt("runtime", 0);
        if (runtime > 0) {
            String text = runtime / 60 + "h " + runtime % 60 + "m";
            tvRuntime.setText(kind.isTv() ? getString(R.string.per_episode, text) : text);
        } else tvRuntime.setVisibility(View.GONE);

        double rating = b.getDouble("vote_average", 0);
        if (rating > 0) tvRating.setText(String.format(Locale.getDefault(), "★ %.1f", rating));
        else tvRating.setVisibility(View.GONE);

        ArrayList<String> genres = b.getStringArrayList("genres");
        if (genres != null && !genres.isEmpty()) {
            List<String> shown = new ArrayList<>();
            for (String g : genres) shown.add(Tmdb.genre(g, tr));
            tvGenres.setText(String.join("  ·  ", shown));
        } else tvGenres.setVisibility(View.GONE);

        String overview = Tmdb.overview(movie, tr);
        tvOverview.setText(overview.isEmpty() ? getString(R.string.no_description) : overview);

        String poster = b.getString("poster_path", "");
        if (!poster.isEmpty() && !poster.equals("null")) {
            com.bumptech.glide.Glide.with(requireContext())
                .load("https://image.tmdb.org/t/p/w342" + poster)
                .placeholder(R.drawable.poster_placeholder)
                .into(ivPoster);
        }

        // Buttons
        if (mode.equals("watchlist")) {
            btnWatched.setVisibility(View.VISIBLE);
            btnRemove.setVisibility(View.VISIBLE);
            btnWatched.setOnClickListener(v -> { if (listener != null) listener.onMarkWatched(movie); dismiss(); });
            btnRemove.setOnClickListener(v -> { if (listener != null) listener.onRemove(movie); dismiss(); });
        } else {
            // Search mode: show both Add and Mark Watched
            btnAdd.setVisibility(View.VISIBLE);
            btnAddWatched.setVisibility(View.VISIBLE);
            btnAdd.setOnClickListener(v -> { if (listener != null) listener.onAdd(movie); dismiss(); });
            btnAddWatched.setOnClickListener(v -> { if (listener != null) listener.onMarkWatched(movie); dismiss(); });
        }

        fetchProviders(b.getInt("tmdb_id", 0), tvStreaming, llStreaming);
    }

    // ── Where to watch ────────────────────────────────────────────────────────

    private static final String[] OFFER_TYPES = {"flatrate", "free", "rent", "buy"};

    private static final class Offer {
        final String name; final String logo;
        final Set<String> types = new LinkedHashSet<>();
        Providers.Info info; boolean installed;
        Offer(String name, String logo) { this.name = name; this.logo = logo; }
    }

    private void fetchProviders(int tmdbId, TextView status, ViewGroup container) {
        if (tmdbId == 0) { status.setText(R.string.providers_none); return; }
        executor.execute(() -> {
            try {
                JSONObject tr = Tmdb.providersTR(http, kind, tmdbId);
                handler.post(() -> { if (isAdded()) showProviders(tr, status, container); });
            } catch (Exception e) {
                handler.post(() -> { if (isAdded()) status.setText(R.string.providers_error); });
            }
        });
    }

    private void showProviders(JSONObject tr, TextView status, ViewGroup container) {
        Map<Integer, Offer> offers = new LinkedHashMap<>();
        if (tr != null) {
            for (String type : OFFER_TYPES) {
                JSONArray arr = tr.optJSONArray(type);
                if (arr == null) continue;
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject p = arr.optJSONObject(i);
                    if (p == null) continue;
                    int id = p.optInt("provider_id");
                    Offer o = offers.get(id);
                    if (o == null) {
                        o = new Offer(p.optString("provider_name"), p.optString("logo_path"));
                        o.info = Providers.lookup(o.name);
                        o.installed = o.info != null && Providers.isInstalled(requireContext(), o.info.pkg);
                        offers.put(id, o);
                    }
                    o.types.add(type);
                }
            }
        }
        if (offers.isEmpty()) { status.setText(R.string.providers_none); return; }

        List<Offer> installed = new ArrayList<>(), missing = new ArrayList<>();
        for (Offer o : offers.values()) (o.installed ? installed : missing).add(o);

        container.removeAllViews();
        if (!installed.isEmpty()) addSection(container, getString(R.string.providers_installed), installed);
        if (!missing.isEmpty())   addSection(container, getString(R.string.providers_not_installed), missing);
    }

    private void addSection(ViewGroup container, String header, List<Offer> offers) {
        final android.content.Context ctx = container.getContext();   // themed by the sheet (accent colour of this kind)
        TextView h = new TextView(ctx);
        h.setText(header);
        h.setTextSize(12);
        h.setTypeface(null, android.graphics.Typeface.BOLD);
        h.setTextColor(UiTheme.color(ctx, R.attr.ctAccentLight));
        LinearLayout.LayoutParams hlp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        hlp.topMargin = dp(6); hlp.bottomMargin = dp(6);
        container.addView(h, hlp);

        ChipGroup group = new ChipGroup(ctx);
        group.setChipSpacingHorizontal(dp(6));
        group.setChipSpacingVertical(dp(6));
        for (Offer o : offers) group.addView(chipFor(ctx, o));
        container.addView(group, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    }

    private View chipFor(android.content.Context ctx, Offer o) {
        LinearLayout chip = new LinearLayout(ctx);
        chip.setOrientation(LinearLayout.HORIZONTAL);
        chip.setGravity(Gravity.CENTER_VERTICAL);
        chip.setBackgroundResource(o.installed ? R.drawable.chip_bg : R.drawable.chip_bg_off);
        chip.setPadding(dp(10), dp(6), dp(10), dp(6));
        if (!o.logo.isEmpty()) {
            ImageView iv = new ImageView(ctx);
            iv.setLayoutParams(new LinearLayout.LayoutParams(dp(20), dp(20)));
            com.bumptech.glide.Glide.with(requireContext()).load("https://image.tmdb.org/t/p/w45" + o.logo).into(iv);
            chip.addView(iv);
        }
        TextView tv = new TextView(ctx);
        tv.setText("  " + o.name + "  ·  " + typesLabel(o.types));
        tv.setTextColor(0xFFFFFFFF);
        tv.setTextSize(12);
        chip.addView(tv);
        chip.setOnClickListener(v -> Providers.open(requireContext(), o.name, o.info, o.installed,
            String.valueOf(movie.getOrDefault("title", ""))));
        return chip;
    }

    private String typesLabel(Set<String> types) {
        List<String> out = new ArrayList<>();
        for (String t : types) {
            switch (t) {
                case "flatrate": out.add(getString(R.string.provider_type_stream)); break;
                case "free":     out.add(getString(R.string.provider_type_free));   break;
                case "rent":     out.add(getString(R.string.provider_type_rent));   break;
                default:         out.add(getString(R.string.provider_type_buy));
            }
        }
        return String.join(" / ", out);
    }

    private int dp(int val) {
        return (int) (val * getResources().getDisplayMetrics().density);
    }

    @Override public void onDestroy() { super.onDestroy(); executor.shutdown(); }
}
