# Firebase

Both apps share one Firebase project: **Authentication** (email + password) and **Firestore** (lists and Watch Together sessions).

## Security rules

[`firestore.rules`](firestore.rules) is the whole access policy. In short:

- Every call needs a signed-in user with a **verified email**.
- `watchlists/{uid}/...` (lists, ratings, notes): readable and writable by that user **only**.
- Watch Together: `sessions/{code}` is shared by the two members. Each member also publishes a short-lived summary to
  `sessions/{code}/payload/{uid}` (titles, genres, ratings, never notes), readable only by the two members.
- Everything else is denied.

```bash
cd firebase
npm install
npm test                  # starts the Firestore emulator (needs a recent Java; it ran on 22) and runs the rule tests
npm run deploy:rules      # or paste the file in console -> Firestore -> Rules
```

> On Windows the emulator's Java process may keep running after `npm test`. Stop it if the next run says port 8080 is taken.

## One-time console setup

**Authentication**
- Sign-in method: enable *Email/Password*.
- Settings → User actions: turn on *Email enumeration protection*.
- Settings → Password policy: optional. The apps already require 8 characters when signing up. If you enforce a policy
  on a project that has older accounts, use *Notify* mode so people with shorter passwords can still sign in.
- Templates: set the sender name of the verification, password-reset and email-change messages.

**Abandoned Watch Together data**

Sessions and their summaries carry an `expireAt` time. Firestore's TTL feature could delete them automatically, but it
needs a paid (Blaze) plan, so by default the apps clean up after themselves: on start, each one removes its own
sessions that are past `expireAt` (`cleanupStaleSessions` on desktop, `SessionCleanup` on Android).
If your project is on Blaze you can add TTL policies as well (offset 0):

```bash
gcloud firestore fields ttls update expireAt --collection-group=sessions --enable-ttl --project=<your-project>
gcloud firestore fields ttls update expireAt --collection-group=payload  --enable-ttl --project=<your-project>
```

**API key** (Google Cloud console → APIs & Services → Credentials → the key the apps use)
- API restrictions: *Identity Toolkit API*, *Token Service API*, *Cloud Firestore API* only.
- The Firebase web key is public by design (it is in every installed app). The rules above are what protect the data.

## Running the apps against your own Firebase project

Create a project, enable the two services above, deploy these rules, then point the apps at it:
`VITE_FIREBASE_*` in `desktop/.env`, and your own `mobile/app/google-services.json`.
