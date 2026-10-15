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
npm test                  # starts the Firestore emulator (needs a recent Java; it ran on 22) and runs 24 rule tests
npm run deploy:rules      # or paste the file in console -> Firestore -> Rules
```

> On Windows the emulator's Java process may keep running after `npm test`. Stop it if the next run says port 8080 is taken.

## One-time console setup

**Authentication**
- Sign-in method: enable *Email/Password*.
- Settings → User actions: turn on *Email enumeration protection*.
- Settings → Password policy: require at least 8 characters (the apps check this too).
- Templates: set the sender name and language of the verification and password-reset emails.

**Firestore TTL** (removes abandoned Watch Together data; Firestore does not do this by itself)

```bash
gcloud firestore fields ttls update expireAt --collection-group=sessions --enable-ttl --project=cinematrack-f5ee4
gcloud firestore fields ttls update expireAt --collection-group=payload  --enable-ttl --project=cinematrack-f5ee4
```

**API key** (Google Cloud console → APIs & Services → Credentials → the key the apps use)
- API restrictions: *Identity Toolkit API*, *Token Service API*, *Cloud Firestore API* only.
- The Firebase web key is public by design (it is in every installed app). The rules above are what protect the data.

## Running the apps against your own Firebase project

Create a project, enable the two services above, deploy these rules, then point the apps at it:
`VITE_FIREBASE_*` in `desktop/.env`, and your own `mobile/app/google-services.json`.
