package com.cinematrack.share;

import com.google.android.gms.tasks.Task;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.firestore.CollectionReference;
import com.google.firebase.firestore.EventListener;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.firestore.ListenerRegistration;
import com.google.firebase.firestore.Query;
import com.google.firebase.firestore.QuerySnapshot;
import java.util.*;

/**
 * Firestore access for the user's lists. Everything is per media kind:
 * movies live in watchlists/{uid}/movies + watchlog, series in watchlists/{uid}/shows + showlog.
 */
public class FirestoreHelper {

    // Keys come from local.properties (not in git) via BuildConfig - see app/build.gradle
    public static final String TMDB_KEY = BuildConfig.TMDB_KEY;
    public static final String GEMINI_KEY = BuildConfig.GEMINI_KEY;
    public static final String RAPID_KEY = BuildConfig.RAPID_KEY;
    public static final String RAPID_HOST = "instagram-scraper-api12.p.rapidapi.com";

    private static FirebaseFirestore db() { return FirebaseFirestore.getInstance(); }

    /** Same name the desktop app uses in Watch Together (Firebase displayName, else the part of the email before the @). */
    public static String username(FirebaseUser user) {
        String name = user.getDisplayName();
        if (name != null && !name.trim().isEmpty()) return name.trim();
        String email = user.getEmail();
        if (email == null) return user.getUid();
        int at = email.indexOf('@');
        return at > 0 ? email.substring(0, at) : email;
    }

    public static CollectionReference watchlistRef(String uid, MediaKind kind) {
        return db().collection("watchlists").document(uid).collection(kind.watchlistCollection);
    }

    public static CollectionReference logRef(String uid, MediaKind kind) {
        return db().collection("watchlists").document(uid).collection(kind.logCollection);
    }

    public static Task<Void> addToWatchlist(String uid, MediaKind kind, Map<String, Object> movie) {
        String tmdbId = String.valueOf(movie.get("tmdb_id"));
        return watchlistRef(uid, kind).document(tmdbId).set(movie);
    }

    public static Task<Void> removeFromWatchlist(String uid, MediaKind kind, int tmdbId) {
        return watchlistRef(uid, kind).document(String.valueOf(tmdbId)).delete();
    }

    public static Task<QuerySnapshot> getWatchlist(String uid, MediaKind kind) {
        return watchlistRef(uid, kind).get();
    }

    public static ListenerRegistration listenWatchlist(String uid, MediaKind kind, EventListener<QuerySnapshot> listener) {
        return watchlistRef(uid, kind).addSnapshotListener(listener);
    }

    public static Task<Void> addWatchLog(String uid, MediaKind kind, Map<String, Object> entry) {
        String logId = uid + "_" + entry.get("tmdb_id") + "_" + System.currentTimeMillis();
        entry.put("log_id", logId);
        return logRef(uid, kind).document(logId).set(entry);
    }

    public static Task<Void> removeWatchLog(String uid, MediaKind kind, String logId) {
        return logRef(uid, kind).document(logId).delete();
    }

    public static Task<QuerySnapshot> getWatchLog(String uid, MediaKind kind) {
        return logRef(uid, kind).orderBy("watched_at", Query.Direction.DESCENDING).get();
    }
}
