package com.cinematrack.share;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.*;
import android.widget.*;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import com.google.android.gms.tasks.Task;
import com.google.android.gms.tasks.Tasks;
import com.google.firebase.Timestamp;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.firestore.DocumentReference;
import com.google.firebase.firestore.DocumentSnapshot;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.firestore.FirebaseFirestoreException;
import com.google.firebase.firestore.ListenerRegistration;
import com.google.firebase.firestore.QuerySnapshot;
import org.json.JSONArray;
import org.json.JSONObject;
import java.security.SecureRandom;
import java.util.*;
import java.util.concurrent.*;
import okhttp3.*;

/**
 * Watch Together. Speaks the same session protocol as the desktop app:
 * waiting → both_joined → creator_ready / partner_ready → resolving → resolved,
 * with creatorVote / partnerVote ("ok" | "again") on the result screen.
 * A session is either for movies or for series ("kind"); both people must be in the same tab type.
 */
public class TogetherFragment extends Fragment {

    public static TogetherFragment newInstance(MediaKind kind) {
        TogetherFragment f = new TogetherFragment();
        Bundle b = new Bundle();
        b.putString("kind", kind.key);
        f.setArguments(b);
        return f;
    }

    private MediaKind kind = MediaKind.MOVIE;
    private LinearLayout layoutMenu, layoutWaiting, layoutPreference, layoutSubmitted, layoutResult;
    private TextView tvCode, tvStatus, tvPartner, tvResultTitle, tvResultSource, tvResultReason;
    private EditText etPreference, etJoinCode;
    private Button btnCreate, btnJoin, btnSubmit, btnRandom, btnAgain, btnOk, btnLeave;
    private ProgressBar progressBar;
    private ImageView ivResultPoster;

    private String sessionId = null;
    private ListenerRegistration sessionListener = null;
    private String lastStatus = null;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final OkHttpClient http = new OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS).build();
    private Map<String, Object> currentSession = null;

    // Sessions and summaries are throw-away: a Firestore TTL policy on `expireAt` removes forgotten ones
    private static final long SESSION_TTL_MS = 2L * 24 * 3600 * 1000;
    private static final long PAYLOAD_TTL_MS = 24L * 3600 * 1000;
    private static final SecureRandom RANDOM = new SecureRandom();

    @Nullable @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        kind = MediaKind.fromKey(requireArguments().getString("kind"));
        return UiTheme.inflater(inflater, kind).inflate(R.layout.fragment_together, container, false);
    }

    @Override
    public void onViewCreated(@NonNull View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);
        layoutMenu       = view.findViewById(R.id.layoutMenu);
        layoutWaiting    = view.findViewById(R.id.layoutWaiting);
        layoutPreference = view.findViewById(R.id.layoutPreference);
        layoutSubmitted  = view.findViewById(R.id.layoutSubmitted);
        layoutResult     = view.findViewById(R.id.layoutResult);
        tvCode           = view.findViewById(R.id.tvCode);
        tvStatus         = view.findViewById(R.id.tvStatus);
        tvPartner        = view.findViewById(R.id.tvPartner);
        tvResultTitle    = view.findViewById(R.id.tvResultTitle);
        tvResultSource   = view.findViewById(R.id.tvResultSource);
        tvResultReason   = view.findViewById(R.id.tvResultReason);
        etPreference     = view.findViewById(R.id.etPreference);
        etJoinCode       = view.findViewById(R.id.etJoinCode);
        btnCreate        = view.findViewById(R.id.btnCreate);
        btnJoin          = view.findViewById(R.id.btnJoin);
        btnSubmit        = view.findViewById(R.id.btnSubmit);
        btnRandom        = view.findViewById(R.id.btnRandom);
        btnAgain         = view.findViewById(R.id.btnAgain);
        btnOk            = view.findViewById(R.id.btnOk);
        btnLeave         = view.findViewById(R.id.btnLeave);
        progressBar      = view.findViewById(R.id.progressBar);
        ivResultPoster   = view.findViewById(R.id.ivResultPoster);

        if (kind.isTv()) {
            ((TextView) view.findViewById(R.id.tvTogetherSubtitle)).setText(R.string.together_subtitle_tv);
            etPreference.setHint(R.string.together_pref_hint_tv);
            ((TextView) view.findViewById(R.id.tvResultFound)).setText(R.string.together_found_tv);
        }

        showLayout(layoutMenu);

        btnCreate.setOnClickListener(v -> createSession(0));
        btnJoin.setOnClickListener(v -> joinSession());
        btnSubmit.setOnClickListener(v -> submitPreference(false));
        btnRandom.setOnClickListener(v -> submitPreference(true));
        btnLeave.setOnClickListener(v -> leaveSession());
        btnOk.setOnClickListener(v -> voteOk());
        btnAgain.setOnClickListener(v -> voteAgain());

        Button btnCancelWaiting = view.findViewById(R.id.btnCancelWaiting);
        if (btnCancelWaiting != null) btnCancelWaiting.setOnClickListener(v -> leaveSession());
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private FirebaseFirestore db() { return FirebaseFirestore.getInstance(); }

    private DocumentReference sessionRef(String id) { return db().collection("sessions").document(id); }

    private DocumentReference payloadRef(String sid, String uid) {
        return sessionRef(sid).collection("payload").document(uid);
    }

    private String isoNow() {
        java.text.SimpleDateFormat f = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(new Date());
    }

    private void toast(String msg) {
        if (getContext() != null) Toast.makeText(getContext(), msg, Toast.LENGTH_SHORT).show();
    }

    private void toast(int resId, Object... args) {
        if (getContext() != null) toast(getString(resId, args));
    }

    private boolean isCreator(Map<String, Object> session, FirebaseUser user) {
        return user.getUid().equals(session.get("creatorId"));
    }

    // ── Create / join ─────────────────────────────────────────────────────────

    private void createSession(int attempt) {
        FirebaseUser user = FirebaseAuth.getInstance().getCurrentUser();
        if (user == null) return;
        final String id = generateCode();

        Map<String, Object> session = new HashMap<>();
        session.put("id", id);
        session.put("kind", kind.key);
        session.put("creatorId", user.getUid());
        session.put("creatorUsername", FirestoreHelper.username(user));
        session.put("partnerId", null);
        session.put("partnerUsername", null);
        session.put("status", "waiting");
        session.put("creatorPreference", null);
        session.put("partnerPreference", null);
        session.put("creatorIsRandom", false);
        session.put("partnerIsRandom", false);
        session.put("result", null);
        session.put("creatorVote", null);
        session.put("partnerVote", null);
        session.put("createdAt", isoNow());
        session.put("expireAt", new Timestamp(new Date(System.currentTimeMillis() + SESSION_TTL_MS)));

        // Never overwrite an existing session that happens to have the same code
        db().runTransaction(tx -> {
            DocumentReference ref = sessionRef(id);
            if (tx.get(ref).exists()) {
                throw new FirebaseFirestoreException("code taken", FirebaseFirestoreException.Code.ALREADY_EXISTS);
            }
            tx.set(ref, session);
            return null;
        }).addOnSuccessListener(v -> {
            sessionId = id;
            tvCode.setText(id);
            showLayout(layoutWaiting);
            listenSession();
        }).addOnFailureListener(e -> {
            if (e instanceof FirebaseFirestoreException
                && ((FirebaseFirestoreException) e).getCode() == FirebaseFirestoreException.Code.ALREADY_EXISTS
                && attempt < 3) {
                createSession(attempt + 1);
            } else {
                toast(R.string.together_create_failed, e.getMessage());
            }
        });
    }

    private void joinSession() {
        final String code = etJoinCode.getText().toString().trim().toUpperCase(Locale.ROOT);
        if (code.length() < 6) { toast(R.string.together_enter_code); return; }
        FirebaseUser user = FirebaseAuth.getInstance().getCurrentUser();
        if (user == null) return;
        final String uid = user.getUid();
        final String username = FirestoreHelper.username(user);
        // Read before the transaction: it runs on another thread
        final String msgNotFound = getString(R.string.together_not_found);
        final String msgOwn = getString(R.string.together_own_session);
        final String msgFull = getString(R.string.together_full);
        final String msgWrongKind = getString(kind.isTv() ? R.string.together_wrong_kind_movie : R.string.together_wrong_kind_tv);

        db().runTransaction(tx -> {
            DocumentReference ref = sessionRef(code);
            DocumentSnapshot s = tx.get(ref);
            if (!s.exists()) {
                throw new FirebaseFirestoreException(msgNotFound, FirebaseFirestoreException.Code.NOT_FOUND);
            }
            String sessionKind = s.getString("kind");
            if (!MediaKind.fromKey(sessionKind).equals(kind)) {   // sessions without a kind are movie sessions
                throw new FirebaseFirestoreException(msgWrongKind, FirebaseFirestoreException.Code.FAILED_PRECONDITION);
            }
            if (uid.equals(s.getString("creatorId"))) {
                throw new FirebaseFirestoreException(msgOwn, FirebaseFirestoreException.Code.FAILED_PRECONDITION);
            }
            if (s.get("partnerId") != null) {
                throw new FirebaseFirestoreException(msgFull, FirebaseFirestoreException.Code.FAILED_PRECONDITION);
            }
            tx.update(ref, "partnerId", uid, "partnerUsername", username, "status", "both_joined");
            return null;
        }).addOnSuccessListener(v -> {
            sessionId = code;
            showLayout(layoutPreference);
            listenSession();
        }).addOnFailureListener(e -> {
            boolean friendly = e instanceof FirebaseFirestoreException && (
                ((FirebaseFirestoreException) e).getCode() == FirebaseFirestoreException.Code.NOT_FOUND
                || ((FirebaseFirestoreException) e).getCode() == FirebaseFirestoreException.Code.FAILED_PRECONDITION);
            if (friendly) toast(e.getMessage()); else toast(R.string.together_join_failed, e.getMessage());
        });
    }

    // ── Preferences → resolve ─────────────────────────────────────────────────

    private void submitPreference(boolean random) {
        if (sessionId == null || currentSession == null) return;
        FirebaseUser user = FirebaseAuth.getInstance().getCurrentUser();
        if (user == null) return;

        final String pref = random ? "random" : etPreference.getText().toString().trim();
        if (!random && pref.isEmpty()) { toast(R.string.together_enter_pref); return; }

        final boolean creator = isCreator(currentSession, user);
        Map<String, Object> updates = new HashMap<>();
        updates.put(creator ? "creatorPreference" : "partnerPreference", pref);
        updates.put(creator ? "creatorIsRandom" : "partnerIsRandom", random);

        final String sid = sessionId;
        final String uid = user.getUid();
        // Publish our summary first: whoever submits second resolves the session and reads both.
        // (Lists are private, so the partner cannot read ours directly; see firebase/firestore.rules.)
        executor.execute(() -> {
            try {
                publishPayload(sid, uid);
            } catch (Exception e) {
                handler.post(() -> toast(R.string.together_submit_failed, e.getMessage()));
                return;
            }
            handler.post(() -> sessionRef(sid).update(updates).addOnSuccessListener(v -> {
                showLayout(layoutSubmitted);
                tvStatus.setText(R.string.together_submitted);
                claimResolution(sid, creator);
            }).addOnFailureListener(e -> toast(R.string.together_submit_failed, e.getMessage())));
        });
    }

    /** This user's lists for the session: titles, genres, ratings, never notes. Blocking: call off the main thread. */
    private void publishPayload(String sid, String uid) throws Exception {
        List<Map<String, Object>> watchlist = new ArrayList<>();
        for (Map<String, Object> m : awaitDocs(FirestoreHelper.getWatchlist(uid, kind))) {
            if (watchlist.size() >= 300) break;
            watchlist.add(summary(m, true));
        }
        List<Map<String, Object>> watched = new ArrayList<>();
        for (Map<String, Object> m : awaitDocs(FirestoreHelper.getWatchLog(uid, kind))) {   // newest first
            if (watched.size() >= 100) break;
            Map<String, Object> entry = summary(m, false);
            entry.put("rating", m.get("rating"));
            watched.add(entry);
        }
        Map<String, Object> doc = new HashMap<>();
        doc.put("uid", uid);
        doc.put("kind", kind.key);
        doc.put("watchlist", watchlist);
        doc.put("watched", watched);
        doc.put("createdAt", Timestamp.now());
        doc.put("expireAt", new Timestamp(new Date(System.currentTimeMillis() + PAYLOAD_TTL_MS)));
        Tasks.await(payloadRef(sid, uid).set(doc), 20, TimeUnit.SECONDS);
    }

    private Map<String, Object> summary(Map<String, Object> m, boolean withOverview) {
        Map<String, Object> s = new HashMap<>();
        for (String key : new String[]{"tmdb_id", "title", "title_tr", "release_date", "genres", "vote_average", "runtime"}) {
            s.put(key, m.get(key));
        }
        s.put("overview", withOverview ? m.get("overview") : "");
        s.put("poster_path", withOverview ? m.get("poster_path") : null);
        return s;
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> listOf(Map<String, Object> payload, String key) {
        Object o = payload.get(key);
        return o instanceof List ? (List<Map<String, Object>>) o : new ArrayList<>();
    }

    /** A member's summary; a missing one (e.g. from an old app version) counts as empty lists. */
    private Map<String, Object> readPayload(String sid, String uid) {
        try {
            DocumentSnapshot snap = Tasks.await(payloadRef(sid, uid).get(), 20, TimeUnit.SECONDS);
            Map<String, Object> data = snap.getData();
            return data != null ? data : new HashMap<>();
        } catch (Exception e) {
            return new HashMap<>();
        }
    }

    /** Delete our summary when the session ends (best effort; the TTL policy removes any that are missed). */
    private void deleteOwnPayload(String sid) {
        FirebaseUser user = FirebaseAuth.getInstance().getCurrentUser();
        if (sid != null && user != null) payloadRef(sid, user.getUid()).delete();
    }

    /**
     * Exactly one device gets to resolve: whoever flips the status to "resolving" inside the
     * transaction. If the partner hasn't submitted yet, just mark ourselves as ready.
     */
    private void claimResolution(String sid, boolean creator) {
        db().runTransaction(tx -> {
            DocumentReference ref = sessionRef(sid);
            DocumentSnapshot s = tx.get(ref);
            if (!s.exists()) return null;
            boolean bothReady = s.get("creatorPreference") != null && s.get("partnerPreference") != null;
            String status = String.valueOf(s.get("status"));
            if (bothReady) {
                if ("resolving".equals(status) || "resolved".equals(status)) return null;
                tx.update(ref, "status", "resolving");
                return s.getData();
            }
            tx.update(ref, "status", creator ? "creator_ready" : "partner_ready");
            return null;
        }).addOnSuccessListener(session -> {
            if (session != null) resolveSession(sid, session);
        }).addOnFailureListener(e -> toast(R.string.together_generic_error, e.getMessage()));
    }

    private void resolveSession(String sid, Map<String, Object> session) {
        if (progressBar != null) progressBar.setVisibility(View.VISIBLE);
        final boolean turkish = Lang.isTurkish();
        executor.execute(() -> {
            Map<String, Object> result = null;
            String errorCode = null;
            try {
                String creatorId = String.valueOf(session.get("creatorId"));
                String partnerId = String.valueOf(session.get("partnerId"));
                String creatorUsername = String.valueOf(session.get("creatorUsername"));
                String partnerUsername = String.valueOf(session.get("partnerUsername"));
                String creatorPref = String.valueOf(session.get("creatorPreference"));
                String partnerPref = String.valueOf(session.get("partnerPreference"));
                boolean creatorRandom = Boolean.TRUE.equals(session.get("creatorIsRandom"));
                boolean partnerRandom = Boolean.TRUE.equals(session.get("partnerIsRandom"));

                // Each member published a summary when they submitted (see publishPayload)
                Map<String, Object> creatorPayload = readPayload(sid, creatorId);
                Map<String, Object> partnerPayload = readPayload(sid, partnerId);
                List<Map<String, Object>> creatorList = listOf(creatorPayload, "watchlist");
                List<Map<String, Object>> partnerList = listOf(partnerPayload, "watchlist");
                List<Map<String, Object>> creatorWatched = listOf(creatorPayload, "watched");
                List<Map<String, Object>> partnerWatched = listOf(partnerPayload, "watched");

                // The CinemaTrack API builds the prompt and asks Gemini: we only send data (users[0] = creator)
                JSONObject request = new JSONObject();
                request.put("kind", kind.key);
                request.put("language", turkish ? "tr" : "en");
                request.put("users", new JSONArray()
                    .put(aiUser(creatorUsername, creatorRandom, creatorPref, creatorWatched, creatorList))
                    .put(aiUser(partnerUsername, partnerRandom, partnerPref, partnerWatched, partnerList)));

                JSONObject rec = ApiClient.post(http, "/v1/ai/together", request).optJSONObject("pick");
                if (rec != null) {
                    String title = rec.optString("title");
                    Map<String, Object> movie = findByTitle(title, creatorList, partnerList);
                    if (movie == null) movie = lookupOnTmdb(title);

                    if (movie != null) {
                        result = new HashMap<>(movie);
                        String[] src = mapSource(rec.optString("source"), creatorUsername, partnerUsername);
                        result.put("source", src[0]);
                        result.put("sourceLabel", src[1]);
                        result.put("reasoning", rec.optString("reasoning"));
                    }
                }
            } catch (Exception e) {
                // result stays null. An API problem (for instance "daily limit reached") is passed on so both
                // screens can say why; anything else shows the plain "no match, try again".
                if (e instanceof ApiClient.ApiException) errorCode = ((ApiClient.ApiException) e).code;
            }

            Map<String, Object> finalResult = result;
            sessionRef(sid).update("result", finalResult, "status", "resolved", "error", errorCode);
            handler.post(() -> { if (progressBar != null) progressBar.setVisibility(View.GONE); });
        });
    }

    private List<Map<String, Object>> awaitDocs(Task<QuerySnapshot> task) throws Exception {
        List<Map<String, Object>> list = new ArrayList<>();
        QuerySnapshot snap = Tasks.await(task, 20, TimeUnit.SECONDS);
        for (DocumentSnapshot doc : snap.getDocuments()) {
            Map<String, Object> d = doc.getData();
            if (d != null) list.add(d);
        }
        return list;
    }

    /** One person's side of the request: what they want, and the facts about their watched and wanted titles. */
    private JSONObject aiUser(String name, boolean random, String pref,
                              List<Map<String, Object>> watched, List<Map<String, Object>> watchlist) throws Exception {
        JSONObject u = new JSONObject();
        u.put("name", name);
        u.put("random", random);
        u.put("prompt", random ? "" : pref);
        u.put("watched", aiItems(watched));
        u.put("watchlist", aiItems(watchlist));
        return u;
    }

    private JSONArray aiItems(List<Map<String, Object>> movies) throws Exception {
        JSONArray out = new JSONArray();
        for (Map<String, Object> m : movies) {
            JSONObject item = new JSONObject();
            item.put("title", m.get("title"));
            Object genres = m.get("genres");
            if (genres instanceof List) item.put("genres", new JSONArray((List<?>) genres));
            item.put("vote_average", m.get("vote_average"));
            item.put("release_date", m.get("release_date"));
            item.put("rating", m.get("rating"));
            out.put(item);
        }
        return out;
    }

    /** Exact (case-insensitive) title match in either watchlist, so we keep the poster etc. */
    private Map<String, Object> findByTitle(String title, List<Map<String, Object>> a, List<Map<String, Object>> b) {
        List<Map<String, Object>> all = new ArrayList<>(a);
        all.addAll(b);
        for (Map<String, Object> m : all) {
            Object t = m.get("title");
            if (t instanceof String && ((String) t).equalsIgnoreCase(title.trim())) return m;
        }
        return null;
    }

    /**
     * Same values the desktop app writes: source key + human label. The API answers "both", "first" (the creator,
     * who was sent first), "second" (the partner) or "gemini".
     */
    private String[] mapSource(String src, String creator, String partner) {
        if ("both".equals(src)) return new String[]{"Both Watchlists", "In both watchlists"};
        if ("first".equals(src)) return new String[]{"Host Watchlist", "From " + creator + "'s watchlist"};
        if ("second".equals(src)) return new String[]{"User2 Watchlist", "From " + partner + "'s watchlist"};
        return new String[]{"Gemini Recommendation", "Gemini Recommendation"};
    }

    private Map<String, Object> lookupOnTmdb(String title) {
        try {
            List<Map<String, Object>> found = Tmdb.search(http, kind, title, "en-US", 1);
            if (found.isEmpty()) return null;
            return Tmdb.details(http, kind, ((Number) found.get(0).get("tmdb_id")).intValue());
        } catch (Exception e) { return null; }
    }

    // ── Live session updates ──────────────────────────────────────────────────

    private void listenSession() {
        if (sessionId == null) return;
        if (sessionListener != null) sessionListener.remove();
        lastStatus = null;
        sessionListener = sessionRef(sessionId).addSnapshotListener((snap, e) -> {
            if (e != null) return;                       // transient error — keep the session, don't delete it
            if (snap == null) return;
            if (!snap.exists()) {
                if (snap.getMetadata().isFromCache()) return;   // not authoritative
                handler.post(this::onSessionEnded);
                return;
            }
            currentSession = snap.getData();
            handler.post(() -> updateUI(currentSession));
        });
    }

    /** The session document is gone (partner left, or both said OK). Nothing to delete. */
    private void onSessionEnded() {
        if (sessionId == null) return;
        boolean finished = "resolved".equals(lastStatus);
        deleteOwnPayload(sessionId);
        resetSessionUi();
        toast(finished ? R.string.together_finished : R.string.together_ended);
    }

    private void updateUI(Map<String, Object> session) {
        if (session == null || getContext() == null) return;
        FirebaseUser user = FirebaseAuth.getInstance().getCurrentUser();
        if (user == null) return;

        String status = String.valueOf(session.get("status"));
        boolean creator = isCreator(session, user);
        String partnerName = String.valueOf(session.get(creator ? "partnerUsername" : "creatorUsername"));
        progressBar.setVisibility(View.GONE);

        switch (status) {
            case "waiting":
                showLayout(layoutWaiting);
                tvCode.setText(sessionId);
                break;
            case "both_joined":
                if (!"both_joined".equals(lastStatus)) etPreference.setText("");   // fresh round
                showLayout(layoutPreference);
                tvPartner.setText(getString(R.string.together_session_with, partnerName));
                break;
            case "creator_ready":
            case "partner_ready":
                boolean myReady = creator ? status.equals("creator_ready") : status.equals("partner_ready");
                if (myReady) {
                    showLayout(layoutSubmitted);
                    tvStatus.setText(R.string.together_submitted);
                } else {
                    showLayout(layoutPreference);
                    tvPartner.setText(getString(R.string.together_session_with, partnerName));
                }
                break;
            case "resolving":
                showLayout(layoutSubmitted);
                tvStatus.setText(kind.isTv() ? R.string.together_finding_tv : R.string.together_finding);
                progressBar.setVisibility(View.VISIBLE);
                break;
            case "resolved":
                showResult(session, creator);
                break;
        }
        lastStatus = status;
    }

    @SuppressWarnings("unchecked")
    private void showResult(Map<String, Object> session, boolean creator) {
        Object resultObj = session.get("result");
        Object myVote = session.get(creator ? "creatorVote" : "partnerVote");
        boolean voted = "ok".equals(myVote);

        if (resultObj instanceof Map && ((Map<String, Object>) resultObj).get("title") != null) {
            Map<String, Object> result = (Map<String, Object>) resultObj;
            tvResultTitle.setText(Tmdb.title(result, Lang.isTurkish()));
            Object label = result.get("sourceLabel");
            tvResultSource.setText(label == null ? "" : String.valueOf(label));
            Object reason = result.get("reasoning");
            tvResultReason.setText(reason == null ? "" : String.valueOf(reason));
            Object poster = result.get("poster_path");
            if (poster instanceof String && !((String) poster).isEmpty()) {
                com.bumptech.glide.Glide.with(requireContext())
                    .load("https://image.tmdb.org/t/p/w342" + poster)
                    .into(ivResultPoster);
            } else {
                ivResultPoster.setImageDrawable(null);
            }
            btnOk.setVisibility(View.VISIBLE);
            btnOk.setEnabled(!voted);
            btnOk.setText(voted ? R.string.together_waiting_partner : R.string.lets_watch);
            btnAgain.setEnabled(!voted);
        } else {
            // Resolution failed or nothing matched
            tvResultTitle.setText(R.string.together_no_match);
            tvResultSource.setText("");
            Object errorCode = session.get("error");
            if (errorCode instanceof String) {
                // e.g. the daily limit: say so instead of suggesting different preferences
                tvResultReason.setText(new ApiClient.ApiException((String) errorCode, 0).getMessage());
            } else {
                tvResultReason.setText(R.string.together_no_match_hint);
            }
            ivResultPoster.setImageDrawable(null);
            btnOk.setVisibility(View.GONE);
            btnAgain.setEnabled(true);
        }
        showLayout(layoutResult);
    }

    // ── Votes ─────────────────────────────────────────────────────────────────

    private void voteOk() {
        FirebaseUser user = FirebaseAuth.getInstance().getCurrentUser();
        if (sessionId == null || currentSession == null || user == null) return;
        final String sid = sessionId;
        final boolean creator = isCreator(currentSession, user);
        final String myField = creator ? "creatorVote" : "partnerVote";
        final String otherField = creator ? "partnerVote" : "creatorVote";

        btnOk.setEnabled(false);
        db().runTransaction(tx -> {
            DocumentReference ref = sessionRef(sid);
            DocumentSnapshot s = tx.get(ref);
            if (!s.exists()) return Boolean.TRUE;
            if ("ok".equals(s.get(otherField))) {      // both said OK → we're done, remove the session
                tx.delete(ref);
                return Boolean.TRUE;
            }
            tx.update(ref, myField, "ok");
            return Boolean.FALSE;
        }).addOnSuccessListener(done -> {
            if (Boolean.TRUE.equals(done)) {
                deleteOwnPayload(sid);
                resetSessionUi();
                toast(R.string.together_enjoy);
            }
        }).addOnFailureListener(e -> { btnOk.setEnabled(true); toast(R.string.together_vote_failed, e.getMessage()); });
    }

    private void voteAgain() {
        if (sessionId == null) return;
        Map<String, Object> reset = new HashMap<>();
        reset.put("status", "both_joined");
        reset.put("result", null);
        reset.put("error", null);
        reset.put("creatorPreference", null);
        reset.put("partnerPreference", null);
        reset.put("creatorIsRandom", false);
        reset.put("partnerIsRandom", false);
        reset.put("creatorVote", null);
        reset.put("partnerVote", null);
        sessionRef(sessionId).update(reset)
            .addOnFailureListener(e -> toast(R.string.together_restart_failed, e.getMessage()));
        // the snapshot listener moves everyone back to the preference screen
    }

    // ── Leaving ───────────────────────────────────────────────────────────────

    private void leaveSession() {
        if (sessionId != null) {
            final String sid = sessionId;
            // Delete both summaries first: once the session is gone, nobody can list them any more
            sessionRef(sid).collection("payload").get().addOnCompleteListener(task -> {
                if (task.isSuccessful()) {
                    for (DocumentSnapshot d : task.getResult().getDocuments()) d.getReference().delete();
                }
                sessionRef(sid).delete();
            });
        }
        resetSessionUi();
    }

    private void resetSessionUi() {
        if (sessionListener != null) { sessionListener.remove(); sessionListener = null; }
        sessionId = null;
        currentSession = null;
        lastStatus = null;
        if (progressBar != null) progressBar.setVisibility(View.GONE);
        if (btnOk != null) { btnOk.setVisibility(View.VISIBLE); btnOk.setEnabled(true); btnOk.setText(R.string.lets_watch); }
        if (btnAgain != null) btnAgain.setEnabled(true);
        if (layoutMenu != null) showLayout(layoutMenu);
    }

    private void showLayout(LinearLayout layout) {
        LinearLayout[] all = {layoutMenu, layoutWaiting, layoutPreference, layoutSubmitted, layoutResult};
        for (LinearLayout l : all) l.setVisibility(l == layout ? View.VISIBLE : View.GONE);
    }

    private String generateCode() {
        // 6 characters from A-Z0-9: the Firestore rules only accept ids of exactly this shape
        String chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 6; i++) sb.append(chars.charAt(RANDOM.nextInt(chars.length())));
        return sb.toString();
    }

    @Override
    public void onDestroyView() {
        super.onDestroyView();
        if (sessionListener != null) { sessionListener.remove(); sessionListener = null; }
        executor.shutdown();
    }
}
