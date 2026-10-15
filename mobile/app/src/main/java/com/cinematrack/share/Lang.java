package com.cinematrack.share;

import androidx.appcompat.app.AppCompatDelegate;
import androidx.core.os.LocaleListCompat;
import java.util.Locale;

/** The app language: follows the phone until the user taps the EN/TR button, then stays as chosen. */
public final class Lang {
    private Lang() {}

    public static boolean isTurkish() {
        LocaleListCompat chosen = AppCompatDelegate.getApplicationLocales();
        Locale locale = chosen.isEmpty() ? null : chosen.get(0);
        String lang = locale != null ? locale.getLanguage() : Locale.getDefault().getLanguage();
        return "tr".equals(lang);
    }

    /** Language parameter for TMDB requests. */
    public static String tmdb() {
        return isTurkish() ? "tr-TR" : "en-US";
    }

    /** Switches the whole app (the current activity is recreated by the system). */
    public static void set(boolean turkish) {
        AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags(turkish ? "tr" : "en"));
    }

    public static void toggle() {
        set(!isTurkish());
    }
}
