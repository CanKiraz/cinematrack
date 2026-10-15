export interface Env {
  DB: D1Database
  FIREBASE_PROJECT_ID: string

  // secrets (wrangler secret put ...)
  TMDB_KEY: string
  GEMINI_KEY: string
  RAPID_KEY: string

  // optional settings
  RAPID_HOST?: string          // default: instagram-scraper-api12.p.rapidapi.com
  GEMINI_MODEL?: string        // default: gemini-2.5-flash
  LIMITS?: string              // JSON, merged over DEFAULT_LIMITS
  DISABLED?: string            // "true": kill switch
  DISABLED_FEATURES?: string   // comma separated: tmdb, ai, instagram
}

/** Things the handler needs from the outside world, so tests can swap them. */
export interface Deps {
  fetch: typeof fetch
  now: () => Date
  sleep: (ms: number) => Promise<void>
  /** Firebase public keys. Omitted in production (fetched from Google); tests pass a local set. */
  keys?: import('jose').JWTVerifyGetKey
}
