# CinemaTrack API (Cloudflare Worker)

The desktop and Android apps never hold the TMDB, Gemini or RapidAPI keys. They call this Worker with the
user's Firebase sign-in token, and the Worker calls the services with the real keys. It also enforces usage
limits, so one account cannot use up everybody's free quotas.

```
app ──(Firebase ID token)──▶ Worker ──(secret keys)──▶ TMDB / Gemini / RapidAPI
                               │
                               └── D1: usage counters + Instagram caption cache
```

## What it does for you

- Accepts only tokens signed by Google for **this** Firebase project, from accounts with a **verified email**.
- Builds the AI prompts itself. Apps send data (lists, preferences), never a prompt, so the key cannot be used as a free chatbot.
- Lets apps read only the few TMDB endpoints they need; a caller-supplied `api_key` is refused.
- Counts every call per user and globally (see [Limits](#limits)); failed upstream calls are refunded.
- Caches Instagram captions, because RapidAPI's free plan is only 100 requests a month.
- Has a kill switch and per-feature switches.

## API

All routes except `/health` and `/v1/names/check` need `Authorization: Bearer <Firebase ID token>`. Errors look like
`{ "error": "<code>", "message": "..." }`; limits answer `429` with a `Retry-After` header.

| Route | Body → Response |
|---|---|
| `GET /health` | `{ "ok": true }` |
| `GET /v1/tmdb/<path>?<params>` | Same JSON as TMDB. Allowed: `search/{movie,tv,multi}`, `{movie,tv}/<id>`, `{movie,tv}/<id>/watch/providers`. Params: `query`, `language` (`en-US`), `page`, `append_to_response=translations`. |
| `POST /v1/ai/chat` | `{ kind: "movie"\|"tv", language: "tr"\|"en", messages: [{role: "user"\|"assistant", text}], watchlist: [Item], stats?: {total_watched, favorite_genre, avg_rating}, recent?: [Item] }` → `{ text }` |
| `POST /v1/ai/together` | `{ kind, language, users: [U, U] }` where `U = { name, random: bool, prompt?, watched: [Item], watchlist: [Item] }` → `{ pick: { title, year, genre, reasoning, source: "both"\|"first"\|"second"\|"gemini" } \| null }`. `first` / `second` follow the order of `users`. |
| `POST /v1/ai/titles` | `{ caption }` → `{ titles: [string] }` (at most 3) |
| `POST /v1/instagram/caption` | `{ url }` → `{ caption, cached }` |
| `POST /v1/names/check` (**no token**) | `{ name }` → `{ ok: true }` or `{ ok: false, reason: "format", "blocked" or "reserved" }`. Used while signing up and renaming; see `src/names.ts` for what is refused. |

Calls that count against a limit (everything except `/health`, and an Instagram caption served from the cache) answer with an
`X-RateLimit-Remaining` header: how many more calls of that kind the person has in the current period (day or month).

`Item` = `{ title, genres?: [string], vote_average?, release_date?, rating?, watched_at? }`. Anything else in an item (notes, ids, posters) is ignored.

## Limits

Defaults (`src/limits.ts`), per user and for everyone together:

| Action | Per user | Everyone |
|---|---|---|
| `tmdb` | 1000 / day | 50 000 / day |
| `chat` | 30 / day | 1000 / day |
| `together` | 10 / day | 300 / day |
| `titles` | 20 / day | 300 / day |
| `caption` (RapidAPI) | 3 / month | 80 / month |
| `names` (open route) | shared | 3000 / day |

Change them without redeploying code: set `LIMITS` in `wrangler.toml` (or the dashboard), e.g.
`LIMITS = '{"chat":{"perUser":50,"global":2000}}'`.

Switch things off: `DISABLED = "true"` (everything but `/health`) or `DISABLED_FEATURES = "ai,instagram"`.

## Deploy (once)

You need a free Cloudflare account.

```bash
cd worker
npm install
npx wrangler login
npx wrangler d1 create cinematrack          # prints a database_id: paste it into wrangler.toml
npm run db:migrate:remote
npx wrangler secret put TMDB_KEY            # paste each key when asked
npx wrangler secret put GEMINI_KEY
npx wrangler secret put RAPID_KEY
npm run deploy                              # prints the URL of your Worker
```

The apps need that URL. Update later with `npm run deploy` again; secrets and data stay.

## Develop

```bash
cp .dev.vars.example .dev.vars              # your own keys
npm run db:migrate:local
npm run dev                                 # http://127.0.0.1:8787
npm test                                    # no Cloudflare account or network needed
npm run typecheck
```

Tests run the real SQL on SQLite (Node's built-in `node:sqlite`, Node 22.13+), sign their own Firebase-shaped tokens, and fake the upstream services.
