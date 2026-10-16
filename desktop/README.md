# CinemaTrack for Windows

The desktop app: Electron, React and TypeScript, with a local SQLite database that syncs to the cloud.
Part of the [CinemaTrack monorepo](..); the API it talks to lives in [`../worker`](../worker).

## Run it

You need **Node 22**. No TMDB or Gemini key is needed: the app signs in with Firebase and calls the CinemaTrack API.

```bash
npm install
npm run dev          # the first run downloads Electron (about 100 MB)
```

Create an account in the app (a real email address; a confirmation link is sent) and sign in. **Please use a throw-away account while developing.**

Optional settings go in `.env` (copy `.env.example`): `MAIN_VITE_API_URL` points the app at your own API, `VITE_FIREBASE_*` at your own Firebase project.

## Checks

```bash
npx tsc --noEmit -p tsconfig.web.json     # renderer
npx tsc --noEmit -p tsconfig.node.json    # main process
npm test                                  # Vitest: database layer and date helpers
npm run build
```

## Build the installer

```bash
npm run package      # dist/CinemaTrack-Setup-<version>.exe
```

## How it is put together

```
src/
  main/        Electron main process
    index.ts     window, app lifecycle
    database.ts  local SQLite (node:sqlite) behind a small Db class; one database belongs to one account
    api.ts       calls to the CinemaTrack API (the main process does the network, with the Firebase token the UI hands over)
    ipc.ts       the handlers the UI can call
  preload/     the narrow bridge between the UI and the main process
  renderer/    React UI
    src/pages/       Watchlist, Stats, AI chat, Watch Together
    src/components/  sign-in, heatmap, movie cards, settings (rename, delete account)
    src/services/    sync with Firestore, auth, i18n (English in code, Turkish in i18n-tr.ts), date helpers
test/          Vitest
```

- **Local first.** The watchlist and log live in SQLite on your computer; `services/sync.ts` mirrors changes to Firestore and back, so the phone sees them.
- **One account per database.** The database stores the owner's uid. A different account gets a fresh database and the previous file is kept as a `.bak`.
- **No secrets here.** TMDB, Gemini and RapidAPI keys exist only in the Worker.

Your data is stored in `%APPDATA%\cinematrack\`.
