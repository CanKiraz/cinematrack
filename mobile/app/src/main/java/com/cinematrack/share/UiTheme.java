package com.cinematrack.share;

import android.content.Context;
import android.util.TypedValue;
import android.view.ContextThemeWrapper;
import android.view.LayoutInflater;
import androidx.annotation.AttrRes;

/** CinemaTrack (movies) is blue, DiziTrack (series) is purple. Screens pick their palette from the media kind. */
public final class UiTheme {
    private UiTheme() {}

    public static int themeRes(MediaKind kind) {
        return kind.isTv() ? R.style.Theme_CinemaTrack_Dizi : R.style.Theme_CinemaTrack;
    }

    public static int sheetThemeRes(MediaKind kind) {
        return kind.isTv() ? R.style.BottomSheetTheme_Dizi : R.style.BottomSheetTheme;
    }

    public static Context themed(Context base, MediaKind kind) {
        return new ContextThemeWrapper(base, themeRes(kind));
    }

    /** An inflater whose views resolve ?attr/ctAccent etc. for the given kind. */
    public static LayoutInflater inflater(LayoutInflater base, MediaKind kind) {
        return base.cloneInContext(themed(base.getContext(), kind));
    }

    public static int color(Context ctx, @AttrRes int attr) {
        TypedValue tv = new TypedValue();
        ctx.getTheme().resolveAttribute(attr, tv, true);
        return tv.data;
    }
}
