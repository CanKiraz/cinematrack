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
    private static final int RECENT_WATCHED_IN_PROMPT = 20;

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
                String response = callGemini(history, buildUserContext());
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

    /** Watchlist + watch history summary, same idea as the desktop app's AI chat. Runs on the background thread. */
    private String buildUserContext() {
        FirebaseUser user = FirebaseAuth.getInstance().getCurrentUser();
        if (user == null) return "";
        String uid = user.getUid();
        final boolean tr = Lang.isTurkish();
        final String noun = kind.isTv() ? "TV series" : "movies";
        StringBuilder sb = new StringBuilder();

        try {
            QuerySnapshot wl = Tasks.await(FirestoreHelper.getWatchlist(uid, kind), 15, TimeUnit.SECONDS);
            if (wl.isEmpty()) {
                sb.append("\n\nUser has no ").append(noun).append(" in their watchlist yet.");
            } else {
                sb.append("\n\nUser's current watchlist:");
                int n = 0;
                for (DocumentSnapshot d : wl.getDocuments()) {
                    if (n++ >= MAX_WATCHLIST_IN_PROMPT) break;
                    sb.append("\n- ").append(Tmdb.title(d.getData(), tr));
                    List<?> g = (List<?>) d.get("genres");
                    if (g != null && !g.isEmpty()) {
                        sb.append(" (").append(g.get(0));
                        if (g.size() > 1) sb.append(", ").append(g.get(1));
                        sb.append(")");
                    }
                    Number r = d.getDouble("vote_average");
                    if (r != null && r.doubleValue() > 0) sb.append(String.format(Locale.US, " ★%.1f", r.doubleValue()));
                }
            }
        } catch (Exception ignored) { /* answer without watchlist context */ }

        try {
            QuerySnapshot log = Tasks.await(FirestoreHelper.getWatchLog(uid, kind), 15, TimeUnit.SECONDS);
            Map<String, Integer> genreCount = new HashMap<>();
            double ratingSum = 0; int ratingCount = 0;
            StringBuilder recent = new StringBuilder();
            int shown = 0;
            for (DocumentSnapshot d : log.getDocuments()) {   // already newest first
                Long rating = d.getLong("rating");
                if (rating != null && rating > 0) { ratingSum += rating; ratingCount++; }
                List<?> genres = (List<?>) d.get("genres");
                if (genres != null) for (Object g : genres) genreCount.merge(String.valueOf(g), 1, Integer::sum);
                if (shown++ < RECENT_WATCHED_IN_PROMPT) {
                    recent.append("\n- ").append(Tmdb.title(d.getData(), tr)).append(" — ").append(d.getString("watched_at"));
                    if (rating != null && rating > 0) recent.append(", rated ").append(rating).append("/10");
                }
            }
            String fav = "unknown"; int best = 0;
            for (Map.Entry<String, Integer> e : genreCount.entrySet()) {
                if (e.getValue() > best) { best = e.getValue(); fav = Tmdb.genre(e.getKey(), tr); }
            }
            sb.append("\n\nUser's watch stats: ").append(log.size()).append(" ").append(noun).append(" watched total, favorite genre: ")
              .append(fav).append(", average rating: ")
              .append(ratingCount > 0 ? String.format(Locale.US, "%.1f", ratingSum / ratingCount) : "N/A").append(".");
            if (recent.length() > 0) sb.append("\nRecently watched:").append(recent);
        } catch (Exception ignored) { /* answer without history context */ }

        return sb.toString();
    }

    private String callGemini(List<Map<String, String>> history, String userContext) throws Exception {
        StringBuilder conversation = new StringBuilder();
        for (Map<String, String> msg : history) {
            conversation.append("user".equals(msg.get("role")) ? "User: " : "Assistant: ")
                .append(msg.get("text")).append("\n");
        }

        String noun = kind.isTv() ? "TV series" : "movies";
        String prompt = "You are " + (kind.isTv() ? "DiziTrack" : "CinemaTrack") + " AI, a friendly " +
            (kind.isTv() ? "TV series" : "movie") + " assistant. You have access to the user's watchlist " +
            "and stats below. Help them discover " + noun + ", pick from their watchlist, or answer questions about " +
            "their watch history. Be concise and friendly. " +
            (Lang.isTurkish() ? "Always answer in Turkish." : "Answer in English.") + userContext +
            "\n\nConversation:\n" + conversation + "\nAssistant:";

        return GeminiClient.generate(http, prompt, 2048, 0.9, false);
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
