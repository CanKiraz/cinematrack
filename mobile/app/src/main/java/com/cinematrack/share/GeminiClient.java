package com.cinematrack.share;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.IOException;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * Single place for Gemini calls (blocking — call from a background thread).
 * - retries 503/429 ("high demand") a couple of times
 * - optionally turns "thinking" off: on gemini-2.5-flash the thinking tokens are counted
 *   against maxOutputTokens, so small limits can leave little or no room for the answer
 * - throws readable errors instead of failing on a missing "parts" array
 */
public class GeminiClient {

    private static final String URL =
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=";
    private static final int MAX_ATTEMPTS = 3;

    public static String generate(OkHttpClient http, String prompt, int maxTokens,
                                  double temperature, boolean thinking) throws Exception {
        JSONObject gen = new JSONObject().put("maxOutputTokens", maxTokens).put("temperature", temperature);
        if (!thinking) gen.put("thinkingConfig", new JSONObject().put("thinkingBudget", 0));

        JSONObject body = new JSONObject()
            .put("contents", new JSONArray().put(new JSONObject().put("role", "user")
                .put("parts", new JSONArray().put(new JSONObject().put("text", prompt)))))
            .put("generationConfig", gen);

        IOException last = null;
        for (int attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            Request req = new Request.Builder()
                .url(URL + FirestoreHelper.GEMINI_KEY)
                .post(RequestBody.create(body.toString(), MediaType.get("application/json")))
                .build();
            try (Response resp = http.newCall(req).execute()) {
                ResponseBody rb = resp.body();
                String raw = rb != null ? rb.string() : "";
                if (resp.code() == 503 || resp.code() == 429) {
                    last = new IOException("Gemini busy (HTTP " + resp.code() + ")");
                    if (attempt < MAX_ATTEMPTS) { Thread.sleep(1500L * attempt); continue; }
                    throw last;
                }
                if (!resp.isSuccessful()) {
                    String msg = "";
                    try { msg = new JSONObject(raw).getJSONObject("error").optString("message"); } catch (Exception ignored) {}
                    throw new IOException("Gemini HTTP " + resp.code() + (msg.isEmpty() ? "" : ": " + msg));
                }
                return extractText(new JSONObject(raw));
            }
        }
        throw last != null ? last : new IOException("Gemini failed");
    }

    private static String extractText(JSONObject json) throws Exception {
        JSONArray candidates = json.optJSONArray("candidates");
        if (candidates == null || candidates.length() == 0) {
            JSONObject fb = json.optJSONObject("promptFeedback");
            throw new IOException("Gemini returned no answer" + (fb != null ? " (" + fb.optString("blockReason") + ")" : ""));
        }
        JSONObject cand = candidates.getJSONObject(0);
        JSONObject content = cand.optJSONObject("content");
        JSONArray parts = content != null ? content.optJSONArray("parts") : null;
        StringBuilder sb = new StringBuilder();
        if (parts != null) {
            for (int i = 0; i < parts.length(); i++) {
                JSONObject p = parts.getJSONObject(i);
                if (p.optBoolean("thought", false)) continue;
                sb.append(p.optString("text", ""));
            }
        }
        String text = sb.toString().trim();
        if (text.isEmpty()) {
            throw new IOException("Gemini answer was empty (" + cand.optString("finishReason", "unknown") + ")");
        }
        return text;
    }
}
