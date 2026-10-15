# CinemaTrack

Movie and TV tracker for desktop and phone, with AI recommendations and a "Watch Together" picker for two.

> Work in progress. The full README is written last.

| Folder | What |
|---|---|
| [`desktop/`](desktop) | Windows app (Electron, React, SQLite) |
| [`mobile/`](mobile) | Android app (Java) |
| [`worker/`](worker) | API proxy (Cloudflare Workers): keeps TMDB / Gemini keys off the clients |
| [`firebase/`](firebase) | Firestore security rules shared by both apps |

## License

[MIT](LICENSE)

This product uses the TMDB API but is not endorsed or certified by TMDB.
