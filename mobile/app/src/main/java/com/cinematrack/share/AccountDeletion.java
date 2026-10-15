package com.cinematrack.share;

import com.google.android.gms.tasks.Task;
import com.google.android.gms.tasks.Tasks;
import com.google.firebase.FirebaseNetworkException;
import com.google.firebase.FirebaseTooManyRequestsException;
import com.google.firebase.auth.EmailAuthProvider;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseAuthInvalidCredentialsException;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.firestore.CollectionReference;
import com.google.firebase.firestore.DocumentSnapshot;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.firestore.QuerySnapshot;
import com.google.firebase.firestore.WriteBatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * Permanently deletes the signed-in person's online data and then the account itself.
 * Firebase wants a fresh sign-in for this, so the password is asked again. The order matters: the data goes first
 * (the security rules need the account to exist), and if anything fails the account is still there to try again.
 */
final class AccountDeletion {
    private AccountDeletion() {}

    enum Failure { WRONG_PASSWORD, TOO_MANY, NETWORK, OTHER }

    interface Callback {
        /** Called on a background thread. */
        void onDone();
        /** Called on a background thread. */
        void onFailed(Failure why);
    }

    // movies / watchlog = CinemaTrack, shows / showlog = DiziTrack, meta = sync bookkeeping
    private static final String[] LIST_COLLECTIONS = {"movies", "shows", "watchlog", "showlog", "meta"};

    static void run(String password, Callback callback) {
        Executors.newSingleThreadExecutor().execute(() -> {
            try {
                FirebaseUser user = FirebaseAuth.getInstance().getCurrentUser();
                if (user == null || user.getEmail() == null) throw new IllegalStateException("not signed in");
                String uid = user.getUid();
                FirebaseFirestore db = FirebaseFirestore.getInstance();

                await(user.reauthenticate(EmailAuthProvider.getCredential(user.getEmail(), password)));

                for (String name : LIST_COLLECTIONS) {
                    deleteCollection(db, db.collection("watchlists").document(uid).collection(name));
                }
                deleteSessions(db, uid);
                await(user.delete());
                callback.onDone();
            } catch (Exception e) {
                callback.onFailed(classify(e));
            }
        });
    }

    private static <T> T await(Task<T> task) throws Exception {
        return Tasks.await(task, 60, TimeUnit.SECONDS);
    }

    private static void deleteCollection(FirebaseFirestore db, CollectionReference ref) throws Exception {
        while (true) {
            QuerySnapshot snap = await(ref.limit(400).get());
            if (snap.isEmpty()) return;
            WriteBatch batch = db.batch();
            for (DocumentSnapshot d : snap.getDocuments()) batch.delete(d.getReference());
            await(batch.commit());
        }
    }

    /** Every Watch Together session this person is in, with the summaries inside them. */
    private static void deleteSessions(FirebaseFirestore db, String uid) throws Exception {
        QuerySnapshot asCreator = await(db.collection("sessions").whereEqualTo("creatorId", uid).get());
        QuerySnapshot asPartner = await(db.collection("sessions").whereEqualTo("partnerId", uid).get());
        for (QuerySnapshot snap : new QuerySnapshot[]{asCreator, asPartner}) {
            for (DocumentSnapshot session : snap.getDocuments()) {
                deleteCollection(db, session.getReference().collection("payload"));
                await(session.getReference().delete());
            }
        }
    }

    private static Failure classify(Exception e) {
        Throwable cause = e instanceof ExecutionException && e.getCause() != null ? e.getCause() : e;
        if (cause instanceof FirebaseAuthInvalidCredentialsException) return Failure.WRONG_PASSWORD;
        if (cause instanceof FirebaseTooManyRequestsException) return Failure.TOO_MANY;
        if (cause instanceof FirebaseNetworkException) return Failure.NETWORK;
        return Failure.OTHER;
    }
}
