package com.cinematrack.share;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.ColorStateList;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.widget.Button;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.Fragment;
import androidx.fragment.app.FragmentManager;
import androidx.fragment.app.FragmentTransaction;
import com.google.android.material.bottomnavigation.BottomNavigationView;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;

/**
 * Two apps in one shell: CinemaTrack (movies, blue) and DiziTrack (series, purple).
 * The top bar switches between them, the bottom bar picks the screen (watchlist, stats, AI chat, together).
 * All eight screens are created once and shown/hidden, so a Watch Together session or a chat survives switching.
 */
public class MainActivity extends AppCompatActivity {

    private static final String PREFS = "cinematrack_ui";
    private static final String KEY_MODE = "mode";
    private static final String[] TABS = {"watchlist", "stats", "ai", "together"};

    private MediaKind kind = MediaKind.MOVIE;
    private String tab = "watchlist";
    private BottomNavigationView nav;
    private Button btnModeMovie, btnModeTv, btnLang;

    private static String tagFor(MediaKind k, String tab) { return k.key + "_" + tab; }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FirebaseUser user = FirebaseAuth.getInstance().getCurrentUser();
        if (!LoginActivity.isReady(user)) {   // not signed in, or the email is not verified yet
            startActivity(new Intent(this, LoginActivity.class));
            finish();
            return;
        }

        setContentView(R.layout.activity_main);
        nav = findViewById(R.id.bottomNav);
        btnModeMovie = findViewById(R.id.btnModeMovie);
        btnModeTv = findViewById(R.id.btnModeTv);
        btnLang = findViewById(R.id.btnLang);

        kind = MediaKind.fromKey(getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_MODE, "movie"));
        if (savedInstanceState != null) tab = savedInstanceState.getString("tab", "watchlist");

        // Created once and shown/hidden, not replaced
        if (getSupportFragmentManager().findFragmentByTag(tagFor(MediaKind.MOVIE, "watchlist")) == null) {
            FragmentTransaction tx = getSupportFragmentManager().beginTransaction();
            for (MediaKind k : MediaKind.values()) {
                tx.add(R.id.fragmentContainer, WatchlistFragment.newInstance(k), tagFor(k, "watchlist"));
                tx.add(R.id.fragmentContainer, StatsFragment.newInstance(k), tagFor(k, "stats"));
                tx.add(R.id.fragmentContainer, AIChatFragment.newInstance(k), tagFor(k, "ai"));
                tx.add(R.id.fragmentContainer, TogetherFragment.newInstance(k), tagFor(k, "together"));
            }
            tx.commitNow();
        }

        nav.setOnItemSelectedListener(item -> {
            int id = item.getItemId();
            if (id == R.id.nav_watchlist)     tab = "watchlist";
            else if (id == R.id.nav_stats)    tab = "stats";
            else if (id == R.id.nav_ai)       tab = "ai";
            else if (id == R.id.nav_together) tab = "together";
            else return false;
            showCurrent();
            return true;
        });

        btnModeMovie.setOnClickListener(v -> setMode(MediaKind.MOVIE));
        btnModeTv.setOnClickListener(v -> setMode(MediaKind.TV));
        btnLang.setText(Lang.isTurkish() ? "EN" : "TR");      // shows the language you will switch to
        btnLang.setOnClickListener(v -> Lang.toggle());       // the system recreates the activity in the new language

        nav.setSelectedItemId(idForTab(tab));
        applyModeStyle();
        showCurrent();

        Localization.backfillInBackground(user.getUid());
        SessionCleanup.run(user.getUid());   // forgotten Watch Together sessions
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        out.putString("tab", tab);
    }

    private int idForTab(String t) {
        switch (t) {
            case "stats":    return R.id.nav_stats;
            case "ai":       return R.id.nav_ai;
            case "together": return R.id.nav_together;
            default:         return R.id.nav_watchlist;
        }
    }

    private void setMode(MediaKind k) {
        if (k == kind) return;
        kind = k;
        getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_MODE, k.key).apply();
        applyModeStyle();
        showCurrent();
    }

    /** Shows the screen for the current mode + tab and hides the other seven. */
    private void showCurrent() {
        FragmentManager fm = getSupportFragmentManager();
        FragmentTransaction tx = fm.beginTransaction();
        String wanted = tagFor(kind, tab);
        for (MediaKind k : MediaKind.values()) {
            for (String t : TABS) {
                String tag = tagFor(k, t);
                Fragment f = fm.findFragmentByTag(tag);
                if (f == null) continue;
                if (tag.equals(wanted)) tx.show(f); else tx.hide(f);
            }
        }
        tx.commit();
    }

    /** Blue for movies, purple for series: top bar buttons and bottom bar. */
    private void applyModeStyle() {
        int accent = ContextCompat.getColor(this, kind.isTv() ? R.color.accent_dizi : R.color.accent_blue);
        styleModeButton(btnModeMovie, kind == MediaKind.MOVIE, ContextCompat.getColor(this, R.color.accent_blue));
        styleModeButton(btnModeTv, kind == MediaKind.TV, ContextCompat.getColor(this, R.color.accent_dizi));

        ColorStateList tint = new ColorStateList(
            new int[][]{{android.R.attr.state_checked}, {}},
            new int[]{accent, ContextCompat.getColor(this, R.color.text_tertiary)});
        nav.setItemIconTintList(tint);
        nav.setItemTextColor(tint);
        nav.setItemRippleColor(ColorStateList.valueOf(accent));
    }

    private void styleModeButton(Button b, boolean active, int color) {
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(getResources().getDisplayMetrics().density * 18);
        if (active) bg.setColor(color); else bg.setColor(0x00000000);
        b.setBackground(bg);
        b.setTextColor(active ? 0xFFFFFFFF : ContextCompat.getColor(this, R.color.text_secondary));
    }
}
