# CinemaTrack for Android

The Android app (Java). Same account and same lists as the desktop app, two modes in one: CinemaTrack (movies) and DiziTrack (series).
Part of the [CinemaTrack monorepo](..); the API it talks to lives in [`../worker`](../worker).

## What is in it

- Watchlist (sort by title, rating, year or date added), watched history with ratings and notes, statistics, AI chat and Watch Together.
- **Share from Instagram:** share a reel to CinemaTrack and it finds the movie or series from the caption (`ShareActivity`).
- A settings gear in the top bar: change your display name, sign out, delete your account.
- English and Turkish (`res/values/strings.xml`, `res/values-tr/strings.xml`).

The app keeps no local database: lists are read and written in Firestore directly (offline caching is Firestore's), and
TMDB, Gemini and RapidAPI go through the CinemaTrack API (`ApiClient`). **No API keys are in the app.**

## Build it

Android Studio, or JDK 17 and the Android SDK.

```bash
cp local.properties.example local.properties     # set sdk.dir
./gradlew :app:assembleDebug                     # app/build/outputs/apk/debug/app-debug.apk
```

Copy the APK to your phone and allow installing from that source. `app/google-services.json` is the public Firebase
configuration and is meant to be in the repo (see [SECURITY.md](../SECURITY.md)). To use your own backend, replace it with your
project's file and set `API_URL` in `local.properties` (see the example file).

## Where things are

| File | What |
|---|---|
| `MainActivity` | top bar (mode, language, settings gear) and the four tabs |
| `WatchlistFragment`, `StatsFragment`, `AIChatFragment`, `TogetherFragment` | the screens |
| `LoginActivity` | sign in, create account, reset password, verify email |
| `ApiClient` | calls the API with the Firebase token and turns errors into readable messages |
| `FirestoreHelper` | all Firestore reads and writes |
| `AccountDialog`, `AccountDeletion`, `NameCheck` | settings, account deletion, display-name check |
