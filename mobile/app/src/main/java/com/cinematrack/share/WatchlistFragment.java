package com.cinematrack.share;

import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.*;
import android.widget.*;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.firestore.DocumentSnapshot;
import com.google.firebase.firestore.ListenerRegistration;
import java.text.SimpleDateFormat;
import java.util.*;

/** The user's to-watch list. One class for both CinemaTrack (movies) and DiziTrack (series). */
public class WatchlistFragment extends Fragment implements MovieDetailSheet.OnActionListener {

    public static WatchlistFragment newInstance(MediaKind kind) {
        WatchlistFragment f = new WatchlistFragment();
        Bundle b = new Bundle();
        b.putString("kind", kind.key);
        f.setArguments(b);
        return f;
    }

    private MediaKind kind = MediaKind.MOVIE;
    private ListView lvMovies;
    private SwipeRefreshLayout swipeRefresh;
    private LinearLayout layoutEmpty;
    private TextView tvCount;
    private EditText etFilter;
    private Spinner spSort;
    private final List<Map<String, Object>> allMovies = new ArrayList<>();
    private final List<Map<String, Object>> filtered  = new ArrayList<>();
    private MovieAdapter adapter;
    private ListenerRegistration listenerReg;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private String sortMode = "title";

    @Nullable @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        kind = MediaKind.fromKey(requireArguments().getString("kind"));
        return UiTheme.inflater(inflater, kind).inflate(R.layout.fragment_watchlist, container, false);
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);
        lvMovies     = view.findViewById(R.id.lvMovies);
        swipeRefresh = view.findViewById(R.id.swipeRefresh);
        layoutEmpty  = view.findViewById(R.id.layoutEmpty);
        tvCount      = view.findViewById(R.id.tvCount);
        etFilter     = view.findViewById(R.id.etFilter);
        spSort       = view.findViewById(R.id.spSort);

        // Labels that differ between movies and series
        ((TextView) view.findViewById(R.id.tvTitle)).setText(kind.isTv() ? R.string.my_series : R.string.my_watchlist);
        ((TextView) view.findViewById(R.id.tvEmptyTitle)).setText(kind.isTv() ? R.string.empty_series_title : R.string.empty_watchlist_title);
        ((TextView) view.findViewById(R.id.tvEmptyHint)).setText(kind.isTv() ? R.string.empty_series_hint : R.string.empty_watchlist_hint);
        ((TextView) view.findViewById(R.id.tvEmptyIcon)).setText(kind.isTv() ? "📺" : "🎬");
        ((Button) view.findViewById(R.id.btnAddMovie)).setText(kind.isTv() ? R.string.add_series : R.string.add_movie);

        // Sort spinner
        ArrayAdapter<String> sortAdapter = new ArrayAdapter<>(requireContext(),
            android.R.layout.simple_spinner_item, getResources().getStringArray(R.array.sort_options));
        sortAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        spSort.setAdapter(sortAdapter);
        spSort.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            public void onItemSelected(AdapterView<?> p, View v, int pos, long id) {
                sortMode = new String[]{"title", "rating", "year_desc", "year_asc"}[pos];
                filterMovies(etFilter.getText().toString());
            }
            public void onNothingSelected(AdapterView<?> p) {}
        });

        // Filter
        etFilter.addTextChangedListener(new android.text.TextWatcher() {
            public void beforeTextChanged(CharSequence s, int st, int c, int a) {}
            public void onTextChanged(CharSequence s, int st, int b, int c) { filterMovies(s.toString()); }
            public void afterTextChanged(android.text.Editable s) {}
        });

        // Add button
        view.findViewById(R.id.btnAddMovie).setOnClickListener(v -> {
            Intent i = new Intent(getActivity(), SearchActivity.class);
            i.putExtra("kind", kind.key);
            startActivity(i);
        });

        swipeRefresh.setColorSchemeColors(UiTheme.color(requireContext(), R.attr.ctAccent));
        swipeRefresh.setOnRefreshListener(() -> swipeRefresh.setRefreshing(false));

        // Critical: block child focus so ListView item clicks work
        lvMovies.setDescendantFocusability(ListView.FOCUS_BLOCK_DESCENDANTS);

        adapter = new MovieAdapter();
        lvMovies.setAdapter(adapter);

        lvMovies.setOnItemClickListener((parent, v, position, id) -> {
            if (position >= filtered.size()) return;
            Map<String, Object> movie = filtered.get(position);
            MovieDetailSheet sheet = MovieDetailSheet.newInstance(movie, "watchlist", kind);
            sheet.setOnActionListener(this);
            sheet.show(getParentFragmentManager(), "detail");
        });

        listenWatchlist();
    }

    private void listenWatchlist() {
        FirebaseUser user = FirebaseAuth.getInstance().getCurrentUser();
        if (user == null) return;
        listenerReg = FirestoreHelper.listenWatchlist(user.getUid(), kind, (snap, e) -> {
            if (snap == null) return;
            allMovies.clear();
            for (DocumentSnapshot doc : snap.getDocuments()) {
                Map<String, Object> m = doc.getData();
                if (m != null) allMovies.add(m);
            }
            filterMovies(etFilter != null ? etFilter.getText().toString() : "");
        });
    }

    private void filterMovies(String q) {
        final boolean tr = Lang.isTurkish();
        final String needle = q.toLowerCase(Locale.getDefault());
        filtered.clear();
        for (Map<String, Object> m : allMovies) {
            String shown = Tmdb.title(m, tr).toLowerCase(Locale.getDefault());
            String other = String.valueOf(m.getOrDefault("title", "")).toLowerCase(Locale.getDefault());
            if (needle.isEmpty() || shown.contains(needle) || other.contains(needle)) filtered.add(m);
        }
        // Sort
        switch (sortMode) {
            case "rating":
                filtered.sort((a, b) -> {
                    double ra = a.get("vote_average") != null ? ((Number) a.get("vote_average")).doubleValue() : 0;
                    double rb = b.get("vote_average") != null ? ((Number) b.get("vote_average")).doubleValue() : 0;
                    return Double.compare(rb, ra);
                });
                break;
            case "year_desc":
                filtered.sort((a, b) -> String.valueOf(b.getOrDefault("release_date", ""))
                    .compareTo(String.valueOf(a.getOrDefault("release_date", ""))));
                break;
            case "year_asc":
                filtered.sort((a, b) -> String.valueOf(a.getOrDefault("release_date", ""))
                    .compareTo(String.valueOf(b.getOrDefault("release_date", ""))));
                break;
            default:
                java.text.Collator collator = java.text.Collator.getInstance(Locale.getDefault());
                filtered.sort((a, b) -> collator.compare(Tmdb.title(a, tr), Tmdb.title(b, tr)));
        }
        handler.post(() -> {
            if (adapter != null) adapter.notifyDataSetChanged();
            boolean empty = filtered.isEmpty();
            if (layoutEmpty != null) layoutEmpty.setVisibility(empty ? View.VISIBLE : View.GONE);
            if (lvMovies != null) lvMovies.setVisibility(empty ? View.GONE : View.VISIBLE);
            if (tvCount != null && isAdded()) {
                int n = allMovies.size();
                tvCount.setText(getResources().getQuantityString(kind.isTv() ? R.plurals.series_count : R.plurals.movies_count, n, n));
            }
        });
    }

    @Override
    public void onMarkWatched(Map<String, Object> movie) {
        View dv = UiTheme.inflater(LayoutInflater.from(getContext()), kind).inflate(R.layout.dialog_watched, null);
        RatingBar rb = dv.findViewById(R.id.ratingBar);
        EditText et  = dv.findViewById(R.id.etNotes);
        new android.app.AlertDialog.Builder(requireContext())
            .setTitle(R.string.mark_as_watched)
            .setView(dv)
            .setPositiveButton(R.string.confirm, (d, w) -> {
                int r = Math.round(rb.getRating() * 2); // 0.5-5 stars → 1-10
                String n = et.getText().toString().trim();
                logWatched(movie, r > 0 ? r : null, n.isEmpty() ? null : n);
            })
            .setNegativeButton(R.string.cancel, null).show();
    }

    @Override
    public void onAdd(Map<String, Object> movie) {
        FirebaseUser user = FirebaseAuth.getInstance().getCurrentUser();
        if (user == null) return;
        FirestoreHelper.addToWatchlist(user.getUid(), kind, movie);
    }

    @Override
    public void onRemove(Map<String, Object> movie) {
        removeFromList(movie);
        Toast.makeText(getContext(), R.string.toast_removed, Toast.LENGTH_SHORT).show();
    }

    private void removeFromList(Map<String, Object> movie) {
        FirebaseUser user = FirebaseAuth.getInstance().getCurrentUser();
        if (user == null) return;
        Object id = movie.get("tmdb_id");
        if (id == null) return;
        FirestoreHelper.removeFromWatchlist(user.getUid(), kind, ((Number) id).intValue());
    }

    private void logWatched(Map<String, Object> movie, Integer rating, String notes) {
        FirebaseUser user = FirebaseAuth.getInstance().getCurrentUser();
        if (user == null) return;
        String today = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
        Map<String, Object> entry = new HashMap<>(movie);
        entry.put("watched_at", today);
        entry.put("rating", rating);
        entry.put("notes", notes);
        FirestoreHelper.addWatchLog(user.getUid(), kind, entry)
            .addOnSuccessListener(v -> {
                removeFromList(movie);
                Toast.makeText(getContext(), R.string.toast_marked_watched, Toast.LENGTH_SHORT).show();
            });
    }

    @Override
    public void onDestroyView() {
        super.onDestroyView();
        if (listenerReg != null) listenerReg.remove();
    }

    class MovieAdapter extends BaseAdapter {
        @Override public int getCount() { return filtered.size(); }
        @Override public Object getItem(int pos) { return filtered.get(pos); }
        @Override public long getItemId(int pos) { return pos; }

        @Override
        public View getView(int pos, View cv, ViewGroup parent) {
            if (cv == null) cv = UiTheme.inflater(LayoutInflater.from(getContext()), kind).inflate(R.layout.item_movie, parent, false);
            Map<String, Object> m = filtered.get(pos);
            boolean tr = Lang.isTurkish();

            ((TextView) cv.findViewById(R.id.tvTitle)).setText(Tmdb.title(m, tr));

            String date = String.valueOf(m.getOrDefault("release_date", ""));
            ((TextView) cv.findViewById(R.id.tvYear)).setText(date.length() >= 4 ? date.substring(0, 4) : "");

            List<?> genres = (List<?>) m.get("genres");
            ((TextView) cv.findViewById(R.id.tvGenre)).setText(
                genres != null && !genres.isEmpty() ? Tmdb.genre(String.valueOf(genres.get(0)), tr) : "");

            ((TextView) cv.findViewById(R.id.tvOverview)).setText(Tmdb.overview(m, tr));

            Object rating = m.get("vote_average");
            TextView tvBadge = cv.findViewById(R.id.tvRatingBadge);
            LinearLayout layoutRating = cv.findViewById(R.id.layoutRating);
            if (rating != null && ((Number) rating).doubleValue() > 0) {
                tvBadge.setText(String.format(Locale.getDefault(), "%.1f", ((Number) rating).doubleValue()));
                layoutRating.setVisibility(View.VISIBLE);
            } else { layoutRating.setVisibility(View.GONE); }

            String poster = (String) m.get("poster_path");
            ImageView iv = cv.findViewById(R.id.ivPoster);
            if (poster != null && !poster.isEmpty() && !poster.equals("null")) {
                com.bumptech.glide.Glide.with(requireContext())
                    .load("https://image.tmdb.org/t/p/w92" + poster)
                    .placeholder(R.drawable.poster_placeholder)
                    .into(iv);
            } else {
                iv.setImageResource(R.drawable.ic_movie);
            }
            return cv;
        }
    }
}
