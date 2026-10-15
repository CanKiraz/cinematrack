# Contributing to CinemaTrack

Thanks for looking! CinemaTrack tracks the movies and series you watch, on your PC and your phone, with an AI that helps
you pick what to watch (alone or with someone). It is a small project, and small contributions are welcome: a typo,
a translation, a test, a bug fix, a new idea.

**Looking for something to work on?** Start with issues labelled
[`good first issue`](../../labels/good%20first%20issue). Comment on one to say you are taking it.

## How the project fits together

| Folder | What | Stack |
|---|---|---|
| [`desktop/`](desktop) | Windows app | Electron, React, TypeScript, SQLite (local) |
| [`mobile/`](mobile) | Android app | Java, Firebase |
| [`worker/`](worker) | The CinemaTrack API: the only place that holds the TMDB / Gemini / RapidAPI keys | Cloudflare Workers, D1 |
| [`firebase/`](firebase) | Firestore security rules and their tests | Firebase emulator |

```
desktop app ─┐                         ┌─▶ TMDB
             ├─▶ Worker (the API) ─────┼─▶ Gemini
Android app ─┘      │ verifies the      └─▶ RapidAPI
   │   │            │ Firebase sign-in
   │   └────────────┘
   └──▶ Firebase: sign-in + each person's lists (Firestore, protected by firebase/firestore.rules)
```

You **do not need a TMDB, Gemini or RapidAPI key** to work on the apps. They are not in the apps at all: the apps call
the API, and the API holds the keys.

## Before you start

Pick the part you want to change and run its checks (the same ones CI runs).

**Desktop** (Node 22)
```bash
cd desktop
npm install
npm run dev                                   # opens the app
npx tsc --noEmit -p tsconfig.web.json         # typecheck the UI
npx tsc --noEmit -p tsconfig.node.json        # typecheck the main process
```

**Worker** (Node 22.13+)
```bash
cd worker
npm install
npm test                                      # 60+ tests, no account or network needed
npm run typecheck
npm run dev                                   # local API on http://127.0.0.1:8787 (needs .dev.vars: see worker/README.md)
```

**Firestore rules** (Java 21+)
```bash
cd firebase
npm install
npm test                                      # starts the Firestore emulator and runs the rule tests
```

**Android** (Android Studio, or JDK 17 and the Android SDK)
```bash
cd mobile
cp local.properties.example local.properties  # set sdk.dir
./gradlew :app:assembleDebug                  # app/build/outputs/apk/debug/app-debug.apk
```

### About the backend you run against

By default the apps talk to the official CinemaTrack backend, so `npm run dev` works immediately: create an account in the
app (it needs a real email, we send a confirmation link). **Please use a throw-away account for testing.**
Things worth knowing:

- Your account only ever sees its own lists (see `firebase/firestore.rules`).
- The API limits each account (for example 30 AI chat messages a day), so please do not script against it.
- To work on the backend itself, run your own: create a Firebase project and put its values in `desktop/.env`
  (`VITE_FIREBASE_*`, see `.env.example`) and `mobile/app/google-services.json`, then deploy `firebase/firestore.rules`.
  To run your own API, follow `worker/README.md` and set `MAIN_VITE_API_URL` (desktop) / `API_URL` (Android).

## Making a change

1. Fork, then branch from `main` (`fix/short-description`, `feat/short-description`).
2. Keep the change focused. Several small pull requests beat one big one.
3. **Add or update a test when behaviour changes.** The Worker and the Firestore rules are fully tested, and a change
   there without a test will be asked for one. The apps have no unit tests yet (adding some is a good first issue).
4. Run the checks for the part you touched.
5. Open a pull request and fill in the template. CI must be green.

### Conventions

- **Language:** code, comments, commit messages and docs in English.
- **UI text:** in the desktop app write the English text in code, `t('Add to Watchlist')`, and add the Turkish text to
  `desktop/src/renderer/src/services/i18n-tr.ts`. On Android put both in `res/values/strings.xml` and
  `res/values-tr/strings.xml`. A missing Turkish line simply shows English, so a translation-only pull request is a fine contribution.
- **Comments** explain *why*, not what. Match the style of the file you are editing.
- **Commits:** a short imperative summary ("Fix rating rounding in stats"), then a few lines of why if it is not obvious.

### Security rules of thumb

- **Never commit a secret** (API keys, tokens, service-account files, `.env`, `.dev.vars`, `local.properties`). The Firebase web
  config and `google-services.json` are public by design and are fine; anything else is not.
- Data access is decided by `firebase/firestore.rules` and by the Worker, never by the app. Do not rely on the UI hiding something.
- Found a vulnerability? Please follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Questions and ideas

Open an issue, or start from the templates. No idea is too small, and "I tried this and it was confusing" is useful feedback too.

By contributing you agree that your work is released under the project's [MIT license](LICENSE).
Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
