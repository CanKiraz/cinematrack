package com.cinematrack.share;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.view.*;
import android.widget.*;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import com.google.android.gms.tasks.Tasks;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.firestore.DocumentSnapshot;
import com.google.firebase.firestore.QuerySnapshot;
import java.util.*;
import java.util.concurrent.*;
import okhttp3.OkHttpClient;
import org.json.JSONArray;
import org.json.JSONObject;

public class AIChatFragment extends Fragment {

    public static AIChatFragment newInstance(MediaKind kind) {
        AIChatFragment f = new AIChatFragment();
        Bundle b = new Bundle();
        b.putString("kind", kind.key);
        f.setArguments(b);
        return f;
    }

    private MediaKind kind = MediaKind.MOVIE;
    private static final int MAX_WATCHLIST_IN_PROMPT = 150;
    private static final int RECENT_WATCHED_IN_PROMPT = 15;

    private LinearLayout llMessages;
    private ScrollView scrollView;
    private EditText etMessage;
    private ImageButton btnSend;
    private ProgressBar progressBar;
    // Only touched on the main thread; the background task works on a copy.
    private final List<Map<String, String>> messages = new ArrayList<>();
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final OkHttpClient http = new OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build();

    @Nullable @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        kind = MediaKind.fromKey(requireArguments().getString("kind"));
        return UiTheme.inflater(inflater, kind).inflate(R.layout.fragment_ai_chat, container, false);
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);
        llMessages  = view.findViewById(R.id.llMessages);
        scrollView  = view.findViewById(R.id.scrollView);
        etMessage   = view.findViewById(R.id.etMessage);
        btnSend     = view.findViewById(R.id.btnSend);
        progressBar = view.findViewById(R.id.progressBar);

        btnSend.setOnClickListener(v -> sendMessage());
        etMessage.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == android.view.inputmethod.EditorInfo.IME_ACTION_SEND) {
                sendMessage();
                return true;
            }
            return false;
        });

        etMessage.setHint(kind.isTv() ? R.string.ask_series : R.string.ask_movies);
        addBubble(getString(kind.isTv() ? R.string.ai_greeting_tv : R.string.ai_greeting), false);
    }

    private static Map<String, String> message(String role, String text) {
        Map<String, String> m = new HashMap<>();
        m.put("role", role);
        m.put("text", text);
        return m;
    }

    private void sendMessage() {
        String text = etMessage.getText().toString().trim();
        if (text.isEmpty()) return;
        etMessage.setText("");
        addBubble(text, true);
        messages.add(message("user", text));
        progressBar.setVisibility(View.VISIBLE);
        btnSend.setEnabled(false);

        final List<Map<String, String>> history = new ArrayList<>(messages);
        executor.execute(() -> {
            try {
                String response = askApi(history);
                handler.post(() -> {
                    progressBar.setVisibility(View.GONE);
                    btnSend.setEnabled(true);
                    addBubble(response, false);
                    messages.add(message("assistant", response));
                });
            } catch (Exception e) {
                String reason = e.getMessage() == null ? "" : " (" + e.getMessage() + ")";
                handler.post(() -> {
                    progressBar.setVisibility(View.GONE);
                    btnSend.setEnabled(true);
                    addBubble("Sorry, something went wrong" + reason + ". Try again.", false);
                });
            }
        });
    }

    /**
     * Sends the conversation plus a summary of the watchlist and history to the CinemaTrack API, which builds the
     * prompt and asks Gemini (same idea as the desktop app's AI chat). Runs on the background thread.
     */
    private String askApi(List<Map<String, String>> history) throws Exception {
        FirebaseUser user = FirebaseAuth.getInstance().getCurrentUser();
        if (user == null) throw new ApiClient.ApiException("sign_in_required", 401);
        String uid = user.getUid();
        final boolean tr = Lang.isTurkish();

        JSONObject body = new JSONObject();
        body.put("kind", kind.key);
        body.put("language", tr ? "tr" : "en");

        JSONArray messages = new JSONArray();
        for (Map<String, String> m : history) {
            messages.put(new JSONObject().put("role", m.get("role")).put("text", m.get("text")));
        }
        body.put("messages", messages);

        JSONArray watchlist = new JSONArray();
        try {
            QuerySnapshot wl = Tasks.await(FirestoreHelper.getWatchlist(uid, kind), 15, TimeUnit.SECONDS);
            int n = 0;
            for (DocumentSnapshot d : wl.getDocuments()) {
                if (n++ >= MAX_WATCHLIST_IN_PROMPT) break;
                JSONObject item = new JSONObject().put("title", Tmdb.title(d.getData(), tr));
                List<?> genres = (List<?>) d.get("genres");
                if (genres != null) item.put("genres", new JSONArray(genres));
                Double score = d.getDouble("vote_average");
                if (score != null) item.put("vote_average", score);
                watchlist.put(item);
            }
        } catch (Exception ignored) { /* answer without watchlist context */ }
        body.put("watchlist", watchlist);

        JSONObject stats = new JSONObject();
        JSONArray recent = new JSONArray();
        try {
            QuerySnapshot log = Tasks.await(FirestoreHelper.getWatchLog(uid, kind), 15, TimeUnit.SECONDS);
            Map<String, Integer> genreCount = new HashMap<>();
            double ratingSum = 0; int ratingCount = 0;
            int shown = 0;
            for (DocumentSnapshot d : log.getDocuments()) {   // already newest first
                Long rating = d.getLong("rating");
                if (rating != null && rating > 0) { ratingSum += rating; ratingCount++; }
                List<?> genres = (List<?>) d.get("genres");
                if (genres != null) for (Object g : genres) genreCount.merge(String.valueOf(g), 1, Integer::sum);
                if (shown++ < RECENT_WATCHED_IN_PROMPT) {
                    JSONObject entry = new JSONObject()
                        .put("title", Tmdb.title(d.getData(), tr))
                        .put("watched_at", d.getString("watched_at"));
                    if (rating != null && rating > 0) entry.put("rating", rating);
                    recent.put(entry);
                }
            }
            String fav = null; int best = 0;
            for (Map.Entry<String, Integer> e : genreCount.entrySet()) {
                if (e.getValue() > best) { best = e.getValue(); fav = Tmdb.genre(e.getKey(), tr); }
            }
            stats.put("total_watched", log.size());
            if (fav != null) stats.put("favorite_genre", fav);
            if (ratingCount > 0) stats.put("avg_rating", ratingSum / ratingCount);
        } catch (Exception ignored) { /* answer without history context */ }
        body.put("stats", stats);
        body.put("recent", recent);

        return ApiClient.post(http, "/v1/ai/chat", body).getString("text");
    }

    private void addBubble(String text, boolean isUser) {
        if (getContext() == null) return;
        View bubble = UiTheme.inflater(LayoutInflater.from(getContext()), kind).inflate(R.layout.item_chat_bubble, llMessages, false);
        TextView tvText = bubble.findViewById(R.id.tvText);
        View bubbleCard = bubble.findViewById(R.id.bubbleCard);

        // Escape first (model/user text may contain < > &), then turn simple markdown into HTML
        String formatted = TextUtils.htmlEncode(text)
            .replaceAll("(?m)^[ \\t]*[*\\-][ \\t]+", "• ")    // "* item" bullets
            .replaceAll("\\*\\*(.+?)\\*\\*", "<b>$1</b>")    // **bold**
            .replaceAll("\\*(.+?)\\*", "<i>$1</i>")           // *italic*
            .replaceAll("`(.+?)`", "<tt>$1</tt>")             // `code`
            .replace("\n", "<br/>");
        tvText.setText(android.text.Html.fromHtml(formatted, android.text.Html.FROM_HTML_MODE_COMPACT));

        LinearLayout.LayoutParams params = (LinearLayout.LayoutParams) bubble.getLayoutParams();
        if (isUser) {
            params.gravity = android.view.Gravity.END;
            bubbleCard.setBackgroundResource(R.drawable.bubble_user);
        } else {
            params.gravity = android.view.Gravity.START;
            bubbleCard.setBackgroundResource(R.drawable.bubble_ai);
        }
        bubble.setLayoutParams(params);
        llMessages.addView(bubble);
        scrollView.post(() -> scrollView.fullScroll(View.FOCUS_DOWN));
    }

    @Override
    public void onDestroyView() {
        super.onDestroyView();
        executor.shutdown();
    }
}
