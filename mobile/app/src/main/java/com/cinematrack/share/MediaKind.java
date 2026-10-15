package com.cinematrack.share;

/**
 * CinemaTrack tracks movies, DiziTrack tracks TV series. Both use the same screens and the same
 * document shape; only the Firestore collections, the TMDB endpoint and a few TMDB field names differ.
 */
public enum MediaKind {
    MOVIE("movie", "movies", "watchlog", "title", "release_date"),
    TV("tv", "shows", "showlog", "name", "first_air_date");

    /** TMDB path segment and the value we pass between screens ("movie" / "tv"). */
    public final String key;
    /** watchlists/{uid}/<watchlistCollection> */
    public final String watchlistCollection;
    /** watchlists/{uid}/<logCollection> */
    public final String logCollection;
    /** Name of the title field in TMDB responses. */
    public final String titleField;
    /** Name of the release-date field in TMDB responses. */
    public final String dateField;

    MediaKind(String key, String watchlistCollection, String logCollection, String titleField, String dateField) {
        this.key = key;
        this.watchlistCollection = watchlistCollection;
        this.logCollection = logCollection;
        this.titleField = titleField;
        this.dateField = dateField;
    }

    public boolean isTv() { return this == TV; }

    public static MediaKind fromKey(String key) {
        return "tv".equals(key) ? TV : MOVIE;
    }
}
