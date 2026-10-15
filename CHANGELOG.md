# Changelog

All notable changes to CinemaTrack are written here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/) (while it is `0.x`, anything may still change).

## [Unreleased]

### Added
- **Delete account.** Desktop: Settings → *Delete account…*. Android: Stats → sign-out menu → *Delete account*.
  After asking for the password again, it removes the account and everything stored online: lists, ratings, notes
  and Watch Together sessions. Data saved on the device itself is left alone. The security rules have a test for the exact deletion sequence.

### Changed
- Dependabot no longer proposes major-version updates for the desktop, Android and Firebase test dependencies.
  Those need a manual migration and a test on a real device, so they are done on purpose, one at a time.

## [0.1.0] - 2026-10-15

First test release, handed to a small group of testers. Windows installer and Android APK.

### Added
- **Desktop app (Windows)** and **Android app**, each with two modes: CinemaTrack (movies) and DiziTrack (series).
- Watchlist with search (TMDB), a watched log with ratings and notes, statistics with a calendar heatmap,
  and live sync between desktop and phone.
- **AI chat** that knows your watchlist and history, and **Watch Together**: two people join a session with a 6-letter code,
  each says what they feel like (or "surprise me"), and the AI picks something that suits both.
- On Android: share an Instagram reel to CinemaTrack and it finds the movie or series.
- English and Turkish interface on both platforms.
- **Accounts with a real email address.** Signing up sends a confirmation link; there is "forgot password"; accounts from before real
  emails can be upgraded in the app.
- **The CinemaTrack API** (`worker/`, Cloudflare Workers): the only place that holds the TMDB, Gemini and RapidAPI keys. It checks the
  sign-in, builds every AI prompt itself, allows only a short list of TMDB requests, and limits usage per person and in total
  (for example 30 AI chat messages a day). Instagram captions are cached because the RapidAPI plan is tiny.
- **Firestore security rules** with 24 emulator tests (`firebase/`).
- Continuous integration (typecheck, build and tests for every part), a Gradle wrapper, a contributing guide, a security policy,
  a code of conduct, issue and pull request templates, and a tester guide.

### Changed
- The apps no longer contain any API key and no longer ask for one.
- A person's lists and notes are now readable by that person only. Before, any signed-in user could read them.
- Watch Together no longer reads the other person's lists. Each person publishes a short summary (titles, genres, ratings, never notes)
  into the session, readable only by the two members, and removed when the session ends or expires.
- The desktop app opens on a sign-in screen, because search, AI and sync all need an account.
- When an AI limit is reached, Watch Together says so instead of "no match found".

### Security
- Unverified accounts cannot use the API or the database.
- Desktop: all browser permission requests are denied; external links open only for `http(s)` addresses.
- Android: app data is excluded from automatic backups.

### Known limitations
- The Windows installer is not code-signed, so Windows shows a "protected your PC" warning. Android is a debug-signed APK to install by hand.
- Desktop is Windows only for now.
- The Instagram caption fallback is best effort: its provider allows only 100 requests a month for everyone.

[Unreleased]: https://github.com/CanKiraz/cinematrack/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/CanKiraz/cinematrack/releases/tag/v0.1.0
