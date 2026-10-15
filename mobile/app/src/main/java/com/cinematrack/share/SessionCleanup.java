package com.cinematrack.share;

import com.google.android.gms.tasks.Task;
import com.google.android.gms.tasks.Tasks;
import com.google.firebase.Timestamp;
import com.google.firebase.firestore.DocumentSnapshot;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.firestore.QuerySnapshot;
import java.util.ArrayList;
import java.util.List;

/**
 * Removes this user's abandoned Watch Together sessions (and the summaries inside them) once they are past their
 * `expireAt`. Firestore's own TTL feature needs a paid plan, so the apps tidy up after themselves when they start.
 */
final class SessionCleanup {
    private SessionCleanup() {}

    /** Fire and forget; best effort (a failure just means we try again next start). */
    static void run(String uid) {
        FirebaseFirestore db = FirebaseFirestore.getInstance();
        Task<QuerySnapshot> asCreator = db.collection("sessions").whereEqualTo("creatorId", uid).get();
        Task<QuerySnapshot> asPartner = db.collection("sessions").whereEqualTo("partnerId", uid).get();
        Tasks.whenAllSuccess(asCreator, asPartner).addOnSuccessListener(results -> {
            List<DocumentSnapshot> all = new ArrayList<>();
            for (Object r : results) all.addAll(((QuerySnapshot) r).getDocuments());
            long now = System.currentTimeMillis();
            for (DocumentSnapshot session : all) {
                Timestamp expireAt = session.getTimestamp("expireAt");
                if (expireAt == null || expireAt.toDate().getTime() >= now) continue;   // not expired (or from an old version)
                // summaries first: once the session is gone, nobody can list them any more
                session.getReference().collection("payload").get().addOnCompleteListener(task -> {
                    if (task.isSuccessful()) {
                        for (DocumentSnapshot p : task.getResult().getDocuments()) p.getReference().delete();
                    }
                    session.getReference().delete();
                });
            }
        });
    }
}
