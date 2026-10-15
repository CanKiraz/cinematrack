package com.cinematrack.share;

import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.widget.Toast;
import java.net.URLEncoder;
import java.util.Locale;

/**
 * Knows the Android apps of the streaming services TMDB lists for Turkey: is it installed, how to open it
 * with a search for the title, and where to get it when it is not.
 *
 * Every package here is also declared in AndroidManifest.xml under <queries> — without that Android 11+
 * hides other apps from us and everything would look "not installed".
 */
public final class Providers {
    private Providers() {}

    /** An app and, if known, a web link that the app opens as a search ("%s" = URL-encoded title). */
    public static final class Info {
        public final String pkg;
        public final String searchUrl;   // may be null → just open the app
        Info(String pkg, String searchUrl) { this.pkg = pkg; this.searchUrl = searchUrl; }
    }

    private static final class Entry {
        final String key; final Info info;
        Entry(String key, String pkg, String url) { this.key = key; this.info = new Info(pkg, url); }
    }

    // Matched against the provider name TMDB returns, e.g. "Netflix", "Disney Plus", "Amazon Prime Video", "Max".
    private static final Entry[] KNOWN = {
        new Entry("netflix",            "com.netflix.mediaclient",                "https://www.netflix.com/search?q=%s"),
        new Entry("disney",             "com.disney.disneyplus",                  null),
        new Entry("prime video",        "com.amazon.avod.thirdpartyclient",       "https://www.primevideo.com/search/?phrase=%s"),
        new Entry("amazon video",       "com.amazon.avod.thirdpartyclient",       "https://www.primevideo.com/search/?phrase=%s"),
        new Entry("hbo",                "com.wbd.stream",                         null),
        new Entry("max",                "com.wbd.stream",                         null),
        new Entry("blutv",              "com.bluetv.android",                     null),
        new Entry("google play",        "com.google.android.videos",              null),
        new Entry("google tv",          "com.google.android.videos",              null),
        new Entry("youtube",            "com.google.android.youtube",             "https://www.youtube.com/results?search_query=%s"),
        new Entry("apple tv",           "com.apple.atve.androidtv.appletv",       "https://tv.apple.com/search?term=%s"),
        new Entry("mubi",               "com.mubi",                               "https://mubi.com/search/films?query=%s"),
        new Entry("exxen",              "com.exxen.android",                      null),
        new Entry("gain",               "com.trgain.mikrogain",                   null),
        new Entry("tabii",              "com.trt.tabii.android",                  null),
        new Entry("tod",                "com.digiturk.tod.mobil",                 null),
        new Entry("puhu",               "com.dogusdigital.puhutv",                null),
        new Entry("tivibu",             "com.ttnet.tivibucep",                    null),
        new Entry("tv+",                "com.turkcell.ott",                       null),
        new Entry("bein",               "com.digiturk.iq.mobil",                  null),
    };

    public static Info lookup(String providerName) {
        String n = " " + providerName.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9+ ]", " ").replaceAll("\\s+", " ").trim() + " ";
        for (Entry e : KNOWN) {
            if (n.contains(" " + e.key + " ") || n.startsWith(" " + e.key)) return e.info;
        }
        return null;
    }

    public static boolean isInstalled(Context ctx, String pkg) {
        if (pkg == null) return false;
        try {
            ctx.getPackageManager().getPackageInfo(pkg, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    /**
     * Installed app → open it searching for the title (falls back to just opening it, with the title copied).
     * Not installed → its Play Store page (or a Play Store search when we don't know the package).
     */
    public static void open(Context ctx, String providerName, Info info, boolean installed, String title) {
        if (installed && info != null) {
            if (info.searchUrl != null) {
                try {
                    String url = String.format(info.searchUrl, URLEncoder.encode(title, "UTF-8"));
                    Intent view = new Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage(info.pkg);
                    ctx.startActivity(view);
                    return;
                } catch (ActivityNotFoundException | java.io.UnsupportedEncodingException ignored) {
                    // the app doesn't take that link - open it normally below
                }
            }
            Intent launch = ctx.getPackageManager().getLaunchIntentForPackage(info.pkg);
            if (launch != null) {
                ClipboardManager cm = (ClipboardManager) ctx.getSystemService(Context.CLIPBOARD_SERVICE);
                if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("title", title));
                Toast.makeText(ctx, ctx.getString(R.string.provider_search_in_app), Toast.LENGTH_LONG).show();
                ctx.startActivity(launch);
                return;
            }
        }
        openStore(ctx, providerName, info);
    }

    private static void openStore(Context ctx, String providerName, Info info) {
        Uri market, web;
        try {
            if (info != null) {
                market = Uri.parse("market://details?id=" + info.pkg);
                web = Uri.parse("https://play.google.com/store/apps/details?id=" + info.pkg);
            } else {
                String q = URLEncoder.encode(providerName, "UTF-8");
                market = Uri.parse("market://search?q=" + q + "&c=apps");
                web = Uri.parse("https://play.google.com/store/search?q=" + q + "&c=apps");
            }
        } catch (java.io.UnsupportedEncodingException e) { return; }
        try {
            ctx.startActivity(new Intent(Intent.ACTION_VIEW, market));
        } catch (ActivityNotFoundException e) {
            try { ctx.startActivity(new Intent(Intent.ACTION_VIEW, web)); } catch (ActivityNotFoundException ignored) { /* no browser */ }
        }
    }
}
