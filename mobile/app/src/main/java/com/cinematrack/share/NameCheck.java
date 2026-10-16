package com.cinematrack.share;

import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.json.JSONObject;

/**
 * Asks the CinemaTrack API whether a display name is acceptable (offensive words, reserved names such as "admin").
 * It is a courtesy filter, not a security boundary: if the API cannot be reached the name is let through, so an
 * outage never stops anybody from signing up. Blocking: call from a background thread.
 */
final class NameCheck {
    private NameCheck() {}

    enum Verdict { OK, FORMAT, BLOCKED, RESERVED }

    // Latin letters with accents (Turkish ç ğ ı ö ş ü İ included), digits, . _ -  Other scripts are left out on purpose:
    // the word list on the server can only read Latin letters. Written as ranges so every Android version reads it the same.
    static final Pattern FORMAT = Pattern.compile("^[A-Za-z\\u00C0-\\u024F0-9_.-]{2,20}$");

    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");
    private static final OkHttpClient HTTP = new OkHttpClient.Builder()
        .callTimeout(8, TimeUnit.SECONDS).build();

    static Verdict check(String name) {
        if (!FORMAT.matcher(name).matches()) return Verdict.FORMAT;
        try {
            JSONObject body = new JSONObject().put("name", name);
            Request req = new Request.Builder().url(BuildConfig.API_URL + "/v1/names/check")
                .post(RequestBody.create(body.toString(), JSON)).build();
            try (Response resp = HTTP.newCall(req).execute()) {
                if (!resp.isSuccessful() || resp.body() == null) return Verdict.OK;
                JSONObject out = new JSONObject(resp.body().string());
                if (out.optBoolean("ok", true)) return Verdict.OK;
                String reason = out.optString("reason", "blocked");
                if ("reserved".equals(reason)) return Verdict.RESERVED;
                if ("format".equals(reason)) return Verdict.FORMAT;
                return Verdict.BLOCKED;
            }
        } catch (Exception e) {
            return Verdict.OK;
        }
    }

    /** The message for a refused name. */
    static int message(Verdict v) {
        switch (v) {
            case BLOCKED:  return R.string.name_not_allowed;
            case RESERVED: return R.string.name_reserved;
            default:       return R.string.login_invalid_name;
        }
    }
}
