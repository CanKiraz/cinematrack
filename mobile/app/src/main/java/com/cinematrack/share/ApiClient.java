package com.cinematrack.share;

import com.google.android.gms.tasks.Tasks;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import java.io.IOException;
import java.util.concurrent.TimeUnit;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.json.JSONObject;

/**
 * The CinemaTrack API (worker/). The app never holds the TMDB, Gemini or RapidAPI keys: it proves who the user
 * is with their Firebase ID token and the API does the rest (and enforces the usage limits).
 * Blocking: call from a background thread.
 */
public final class ApiClient {
    private ApiClient() {}

    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");

    /**
     * A problem reported by the API. {@link #getMessage()} is already a sentence the user can read
     * (in the app's language), so existing "show e.getMessage()" code stays friendly.
     */
    public static final class ApiException extends IOException {
        public final String code;
        public final int status;

        public ApiException(String code, int status) {
            super(describe(code));
            this.code = code;
            this.status = status;
        }

        private static String describe(String code) {
            boolean tr = Lang.isTurkish();
            switch (code) {
                case "rate_limited":
                    return tr ? "Bu özellik için günlük sınırına ulaştın. Daha sonra tekrar dene."
                              : "You have reached your limit for this feature. Try again later.";
                case "quota_exhausted":
                    return tr ? "Bu özelliğin herkes için ayrılan payı şimdilik doldu. Daha sonra tekrar dene."
                              : "Everyone's share of this feature is used up for now. Try again later.";
                case "sign_in_required":
                case "missing_token":
                case "invalid_token":
                case "email_not_verified":
                    return tr ? "Lütfen tekrar giriş yap." : "Please sign in again.";
                case "disabled":
                    return tr ? "Bu özellik şimdilik kapalı." : "This feature is switched off for now.";
                case "not_found":
                    return tr ? "Bulunamadı." : "Not found.";
                default:
                    return tr ? "Servis şu an yoğun. Biraz sonra tekrar dene." : "The service is busy. Try again in a moment.";
            }
        }
    }

    public static JSONObject get(OkHttpClient http, String path) throws Exception {
        return call(http, path, null);
    }

    public static JSONObject post(OkHttpClient http, String path, JSONObject body) throws Exception {
        return call(http, path, body);
    }

    private static JSONObject call(OkHttpClient http, String path, JSONObject body) throws Exception {
        FirebaseUser user = FirebaseAuth.getInstance().getCurrentUser();
        if (user == null) throw new ApiException("sign_in_required", 401);

        for (int attempt = 1; ; attempt++) {
            // false = reuse the cached token; the SDK renews it itself when it is about to expire
            String token = Tasks.await(user.getIdToken(attempt > 1), 20, TimeUnit.SECONDS).getToken();

            Request.Builder req = new Request.Builder()
                .url(BuildConfig.API_URL + path)
                .header("Authorization", "Bearer " + token);
            if (body != null) req.post(RequestBody.create(body.toString(), JSON));

            try (Response resp = http.newCall(req.build()).execute()) {
                ResponseBody rb = resp.body();
                String text = rb != null ? rb.string() : "";
                if (resp.isSuccessful()) return new JSONObject(text);

                String code = "upstream_error";
                try { code = new JSONObject(text).optString("error", code); } catch (Exception ignored) { /* not JSON */ }
                // The token expired between getting it and the call: force a fresh one and try once more
                if (resp.code() == 401 && "invalid_token".equals(code) && attempt == 1) continue;
                throw new ApiException(code, resp.code());
            }
        }
    }
}
