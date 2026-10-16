package com.cinematrack.share;

import android.os.Bundle;
import android.view.*;
import android.widget.*;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.firestore.DocumentSnapshot;
import com.google.firebase.firestore.ListenerRegistration;
import java.text.SimpleDateFormat;
import java.util.*;

/** Watch history and numbers. One class for movies (CinemaTrack) and series (DiziTrack). */
public class StatsFragment extends Fragment {

    public static StatsFragment newInstance(MediaKind kind) {
        StatsFragment f = new StatsFragment();
        Bundle b = new Bundle();
        b.putString("kind", kind.key);
        f.setArguments(b);
        return f;
    }

    private MediaKind kind = MediaKind.MOVIE;
    private TextView tvTotal, tvPeriod, tvAvgRating, tvTopGenre, tvPeriodLabel;
    private LinearLayout llHistory;
    private LinearLayout layoutEmpty;
    private String currentFilter = "all"; // all, year, month, week
    private List<Map<String, Object>> allEntries = new ArrayList<>();
    private ListenerRegistration listenerReg;

    @Nullable @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        kind = MediaKind.fromKey(requireArguments().getString("kind"));
        return UiTheme.inflater(inflater, kind).inflate(R.layout.fragment_stats, container, false);
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);
        tvTotal      = view.findViewById(R.id.tvTotal);
        tvPeriod     = view.findViewById(R.id.tvPeriod);
        tvAvgRating  = view.findViewById(R.id.tvAvgRating);
        tvTopGenre   = view.findViewById(R.id.tvTopGenre);
        tvPeriodLabel = view.findViewById(R.id.tvPeriodLabel);
        llHistory    = view.findViewById(R.id.llHistory);
        layoutEmpty  = view.findViewById(R.id.layoutEmpty);

        ((TextView) view.findViewById(R.id.tvEmptyText)).setText(kind.isTv() ? R.string.stats_empty_series : R.string.stats_empty_movies);

        // Filter buttons
        int[] btnIds = {R.id.btnAll, R.id.btnYear, R.id.btnMonth, R.id.btnWeek};
        String[] filters = {"all", "year", "month", "week"};
        for (int i = 0; i < btnIds.length; i++) {
            final String f = filters[i];
            view.findViewById(btnIds[i]).setOnClickListener(v -> {
                currentFilter = f;
                updateFilterButtons(view);
                displayStats();
            });
        }
        updateFilterButtons(view);

        listenWatchLog();
    }

    private void updateFilterButtons(View root) {
        String[] filters = {"all", "year", "month", "week"};
        int[] btnIds = {R.id.btnAll, R.id.btnYear, R.id.btnMonth, R.id.btnWeek};
        for (int i = 0; i < filters.length; i++) {
            android.widget.Button btn = root.findViewById(btnIds[i]);
            if (btn == null) continue;
            boolean active = filters[i].equals(currentFilter);
            btn.setBackgroundResource(active ? R.drawable.btn_primary : R.drawable.btn_secondary);
            btn.setTextColor(active ? 0xFFFFFFFF : 0xFFA1A1AA);
        }
    }

    private void listenWatchLog() {
        FirebaseUser user = FirebaseAuth.getInstance().getCurrentUser();
        if (user == null) return;
        listenerReg = FirestoreHelper.logRef(user.getUid(), kind).addSnapshotListener((snap, e) -> {
            if (snap == null) return;
            allEntries.clear();
            for (DocumentSnapshot doc : snap.getDocuments()) {
                Map<String, Object> d = doc.getData();
                if (d != null) allEntries.add(d);
            }
            allEntries.sort((a, b) -> String.valueOf(b.getOrDefault("watched_at", ""))
                .compareTo(String.valueOf(a.getOrDefault("watched_at", ""))));
            displayStats();
        });
    }

    private List<Map<String, Object>> getFilteredEntries() {
        if (currentFilter.equals("all")) return allEntries;
        Calendar cal = Calendar.getInstance();
        Calendar yearAgo = (Calendar) cal.clone();
        yearAgo.add(Calendar.YEAR, -1);
        yearAgo.set(Calendar.HOUR_OF_DAY, 0);
        yearAgo.set(Calendar.MINUTE, 0);
        yearAgo.set(Calendar.SECOND, 0);
        yearAgo.set(Calendar.MILLISECOND, 0);
        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
        List<Map<String, Object>> result = new ArrayList<>();
        for (Map<String, Object> e : allEntries) {
            String dateStr = String.valueOf(e.getOrDefault("watched_at", ""));
            try {
                Date d = sdf.parse(dateStr);
                if (d == null) continue;
                Calendar ec = Calendar.getInstance();
                ec.setTime(d);
                boolean include = false;
                switch (currentFilter) {
                    case "week":  include = ec.get(Calendar.WEEK_OF_YEAR) == cal.get(Calendar.WEEK_OF_YEAR) && ec.getWeekYear() == cal.getWeekYear(); break;
                    case "month": include = ec.get(Calendar.MONTH) == cal.get(Calendar.MONTH) && ec.get(Calendar.YEAR) == cal.get(Calendar.YEAR); break;
                    case "year":  include = !ec.before(yearAgo); break;   // the last 12 months, not the calendar year
                }
                if (include) result.add(e);
            } catch (Exception ex) { /* skip */ }
        }
        return result;
    }

    private void displayStats() {
        if (getContext() == null) return;
        final boolean tr = Lang.isTurkish();
        List<Map<String, Object>> entries = getFilteredEntries();

        // Period label
        switch (currentFilter) {
            case "week":  tvPeriodLabel.setText(R.string.this_week); break;
            case "month": tvPeriodLabel.setText(R.string.this_month); break;
            case "year":  tvPeriodLabel.setText(R.string.last_12_months); break;
            default:      tvPeriodLabel.setText(R.string.all_time);
        }

        int total = allEntries.size();
        int period = entries.size();
        double ratingSum = 0; int ratingCount = 0;
        Map<String, Integer> genreCount = new HashMap<>();

        for (Map<String, Object> e : entries) {
            Object r = e.get("rating");
            if (r != null && ((Number) r).intValue() > 0) {
                ratingSum += ((Number) r).doubleValue();
                ratingCount++;
            }
            List<?> genres = (List<?>) e.get("genres");
            if (genres != null) for (Object g : genres)
                genreCount.merge(String.valueOf(g), 1, Integer::sum);
        }

        String topGenre = genreCount.entrySet().stream()
            .max(Map.Entry.comparingByValue())
            .map(en -> Tmdb.genre(en.getKey(), tr)).orElse("—");

        tvTotal.setText(String.valueOf(total));
        tvPeriod.setText(String.valueOf(period));
        tvAvgRating.setText(ratingCount > 0 ? String.format(Locale.getDefault(), "%.1f", ratingSum / ratingCount) : "—");
        tvTopGenre.setText(topGenre);

        // History list
        llHistory.removeAllViews();
        boolean empty = entries.isEmpty();
        layoutEmpty.setVisibility(empty ? View.VISIBLE : View.GONE);
        llHistory.setVisibility(empty ? View.GONE : View.VISIBLE);

        LayoutInflater inflater = UiTheme.inflater(LayoutInflater.from(getContext()), kind);
        for (Map<String, Object> e : entries) {
            View item = inflater.inflate(R.layout.item_history, llHistory, false);
            ((TextView) item.findViewById(R.id.tvTitle)).setText(Tmdb.title(e, tr));
            ((TextView) item.findViewById(R.id.tvDate)).setText(String.valueOf(e.getOrDefault("watched_at", "")));

            Object r = e.get("rating");
            TextView tvR = item.findViewById(R.id.tvRating);
            if (r != null && ((Number) r).intValue() > 0) {
                tvR.setText("★ " + r);
                tvR.setVisibility(View.VISIBLE);
            }

            String notes = String.valueOf(e.getOrDefault("notes", ""));
            TextView tvN = item.findViewById(R.id.tvNotes);
            if (!notes.isEmpty() && !notes.equals("null")) {
                tvN.setText(notes);
                tvN.setVisibility(View.VISIBLE);
            }

            String poster = (String) e.get("poster_path");
            ImageView iv = item.findViewById(R.id.ivPoster);
            if (poster != null && !poster.isEmpty() && !poster.equals("null")) {
                com.bumptech.glide.Glide.with(requireContext())
                    .load("https://image.tmdb.org/t/p/w92" + poster)
                    .placeholder(R.drawable.poster_placeholder).into(iv);
            }

            // Long press to delete
            final String logId = String.valueOf(e.getOrDefault("log_id", ""));
            item.setOnLongClickListener(v -> {
                if (logId.isEmpty()) return false;
                new android.app.AlertDialog.Builder(requireContext())
                    .setTitle(R.string.remove_history_title)
                    .setPositiveButton(R.string.remove, (d, w) -> {
                        FirebaseUser u = FirebaseAuth.getInstance().getCurrentUser();
                        if (u != null) FirestoreHelper.removeWatchLog(u.getUid(), kind, logId);
                    })
                    .setNegativeButton(R.string.cancel, null).show();
                return true;
            });
            llHistory.addView(item);
        }
    }

    @Override public void onDestroyView() {
        super.onDestroyView();
        if (listenerReg != null) listenerReg.remove();
    }
}
