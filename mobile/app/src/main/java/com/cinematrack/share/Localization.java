package com.cinematrack.share;

import com.google.android.gms.tasks.Tasks;
import com.google.firebase.firestore.CollectionReference;
import com.google.firebase.firestore.DocumentSnapshot;
import com.google.firebase.firestore.QuerySnapshot;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import okhttp3.OkHttpClient;

/**
 * Titles and overviews are stored in English plus a Turkish copy (title_tr / overview_tr) so the lists can be
 * shown in either language. Entries added before that only have English: this fills in the Turkish text once,
 * quietly in the background (tr_checked marks the entries that were already looked up).
 */
public final class Localization {
    private Localization() {}

    private static boolean started = false;

    public static synchronized void backfillInBackground(String uid) {
        if (started) return;
        started = true;
        new Thread(() -> {
            try { run(uid); } catch (Exception ignored) { /* try again next time the app starts */ }
        }, "turkish-backfill").start();
    }

    private static void run(String uid) throws Exception {
        OkHttpClient http = new OkHttpClient();
        Map<String, Map<String, Object>> cache = new HashMap<>();   // the same movie can be in the list and in the log

        for (MediaKind kind : MediaKind.values()) {
            List<CollectionReference> collections =
                Arrays.asList(FirestoreHelper.watchlistRef(uid, kind), FirestoreHelper.logRef(uid, kind));
            for (CollectionReference collection : collections) {
                QuerySnapshot snap = Tasks.await(collection.get(), 30, TimeUnit.SECONDS);
                for (DocumentSnapshot doc : snap.getDocuments()) {
                    if (Boolean.TRUE.equals(doc.getBoolean("tr_checked"))) continue;
                    Long id = doc.getLong("tmdb_id");
                    if (id == null) continue;

                    String cacheKey = kind.key + ":" + id;
                    Map<String, Object> full = cache.get(cacheKey);
                    if (full == null) {
                        try { full = Tmdb.details(http, kind, id.intValue()); } catch (Exception e) { continue; }
                        cache.put(cacheKey, full);
                    }

                    Map<String, Object> patch = new HashMap<>();
                    patch.put("title_tr", full.get("title_tr"));
                    patch.put("overview_tr", full.get("overview_tr"));
                    patch.put("tr_checked", true);
                    try { Tasks.await(doc.getReference().update(patch), 20, TimeUnit.SECONDS); } catch (Exception ignored) { /* deleted meanwhile */ }
                }
            }
        }
    }
}
