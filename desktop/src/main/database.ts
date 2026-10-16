import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { app } from 'electron'
import fs from 'node:fs'
import path from 'path'

const userDataPath = app.getPath('userData')
const dbPath = path.join(userDataPath, 'cinematrack.db')

/**
 * SQLite comes with Electron's Node (node:sqlite), so there is no native module to compile, ship or keep patched.
 * This is the small part of the better-sqlite3 style API the rest of this file uses.
 */
class Db {
  private readonly raw: DatabaseSync

  constructor(file: string) {
    this.raw = new DatabaseSync(file)
  }

  exec(sql: string): void {
    this.raw.exec(sql)
  }

  pragma(setting: string): void {
    this.raw.exec(`PRAGMA ${setting}`)
  }

  close(): void {
    this.raw.close()
  }

  prepare(sql: string) {
    const statement = this.raw.prepare(sql)
    // Named parameters (@name) are passed as an object. Give node:sqlite only the keys the SQL uses: it refuses extra ones.
    const bind = (args: unknown[]): SQLInputValue[] => {
      const first = args[0]
      if (args.length === 1 && first && typeof first === 'object') {
        const wanted = new Set([...sql.matchAll(/@(\w+)/g)].map(m => m[1]))
        return [Object.fromEntries(Object.entries(first).filter(([key]) => wanted.has(key)))] as SQLInputValue[]
      }
      return args as SQLInputValue[]
    }
    return {
      get: (...args: unknown[]): unknown => statement.get(...bind(args)),
      all: (...args: unknown[]): unknown[] => statement.all(...bind(args)),
      run: (...args: unknown[]) => {
        const result = statement.run(...bind(args))
        return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) }
      }
    }
  }

  /** Returns a function that runs `fn` in a transaction (rolled back if it throws). */
  transaction<T>(fn: () => T): () => T {
    return () => {
      this.raw.exec('BEGIN')
      try {
        const value = fn()
        this.raw.exec('COMMIT')
        return value
      } catch (error) {
        this.raw.exec('ROLLBACK')
        throw error
      }
    }
  }
}

let db: Db

// CinemaTrack = movies, DiziTrack = TV series. Same shape, separate tables
// (a movie and a series can share the same TMDB id, so they must not share a table).
export type Kind = 'movie' | 'tv'

const TABLES = {
  movie: { movies: 'movies', watchlist: 'watchlist', log: 'watch_log' },
  tv:    { movies: 'shows',  watchlist: 'show_watchlist', log: 'show_log' }
} as const

function T(kind: Kind | undefined): { movies: string; watchlist: string; log: string } {
  return TABLES[kind === 'tv' ? 'tv' : 'movie']
}

function createTables(kind: Kind): void {
  const t = T(kind)
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${t.movies} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tmdb_id INTEGER UNIQUE NOT NULL,
      title TEXT NOT NULL,
      overview TEXT DEFAULT '',
      poster_path TEXT,
      release_date TEXT DEFAULT '',
      genres TEXT DEFAULT '[]',
      vote_average REAL DEFAULT 0,
      runtime INTEGER
    );

    CREATE TABLE IF NOT EXISTS ${t.watchlist} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      movie_id INTEGER NOT NULL REFERENCES ${t.movies}(id) ON DELETE CASCADE,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(movie_id)
    );

    CREATE TABLE IF NOT EXISTS ${t.log} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      movie_id INTEGER NOT NULL REFERENCES ${t.movies}(id) ON DELETE CASCADE,
      watched_at TEXT NOT NULL,
      rating INTEGER CHECK(rating IS NULL OR (rating BETWEEN 1 AND 10)),
      notes TEXT
    );
  `)

  // Added later: the Turkish title/overview copy, and the Firestore document id of each log entry
  // (remote_id lets desktop and phone recognise the same entry: no duplicates, deletes reach Firestore)
  ensureColumn(t.movies, 'title_tr', 'TEXT')
  ensureColumn(t.movies, 'overview_tr', 'TEXT')
  ensureColumn(t.log, 'remote_id', 'TEXT')
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${t.log}_remote_id ON ${t.log}(remote_id)`)
}

function ensureColumn(table: string, column: string, type: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!cols.some(c => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
}

export function initDatabase(): void {
  db = new Db(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
  createTables('movie')
  createTables('tv')
}

/** Closes the database file (tests need this to delete their temporary folder on Windows). */
export function closeDatabase(): void {
  db?.close()
}

// ── Config ────────────────────────────────────────────────────────────────────

export function getConfig(key: string): string | null {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setConfig(key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, value)
}

// ── Whose data is this? ───────────────────────────────────────────────────────
// The local database lives on the computer, but what is in it belongs to ONE account. Without that rule, signing out of
// one account and into another on the same computer would upload the first person's whole list to the second's cloud
// (the first sign-in of an account pushes whatever is stored locally).

const BACKUPS_KEPT = 3

/**
 * Call once the signed-in account is known, before anything reads or syncs the local data.
 * - First account to use this database (including data from before accounts existed): it claims it, nothing changes.
 * - Same account as last time: nothing changes.
 * - A different account: the old database is set aside as a backup file and this account starts empty; its own
 *   lists come back from the cloud. `reset` tells the caller that happened.
 */
export function claimLocalDataFor(uid: string): { reset: boolean } {
  const owner = getConfig('owner_uid')
  if (owner === uid) return { reset: false }
  if (owner === null) {
    setConfig('owner_uid', uid)
    return { reset: false }
  }

  db.close()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  for (const suffix of ['', '-wal', '-shm']) {
    const from = dbPath + suffix
    if (fs.existsSync(from)) fs.renameSync(from, `${dbPath}.${stamp}.bak${suffix}`)
  }
  pruneBackups()
  initDatabase()
  setConfig('owner_uid', uid)
  return { reset: true }
}

/** Keeps the newest few backups of other accounts' local data, deletes the rest. */
function pruneBackups(): void {
  const prefix = path.basename(dbPath) + '.'
  const names = fs.readdirSync(userDataPath).filter(n => n.startsWith(prefix) && n.endsWith('.bak')).sort().reverse()
  for (const old of names.slice(BACKUPS_KEPT)) {
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(path.join(userDataPath, old + suffix), { force: true })
  }
}

// ── Movies / series ───────────────────────────────────────────────────────────

export interface MovieRow {
  id: number
  tmdb_id: number
  title: string
  overview: string
  poster_path: string | null
  release_date: string
  genres: string
  vote_average: number
  runtime: number | null
  title_tr?: string | null
  overview_tr?: string | null
}

export function upsertMovie(movie: Omit<MovieRow, 'id'>, kind?: Kind): number {
  const t = T(kind)
  // named parameters must all be present
  const row = { ...movie, title_tr: movie.title_tr ?? null, overview_tr: movie.overview_tr ?? null }
  const existing = db.prepare(`SELECT id FROM ${t.movies} WHERE tmdb_id = ?`).get(row.tmdb_id) as { id: number } | undefined
  if (existing) {
    db.prepare(`
      UPDATE ${t.movies} SET title=@title, overview=@overview, poster_path=@poster_path,
        release_date=@release_date, genres=@genres, vote_average=@vote_average, runtime=@runtime,
        title_tr=COALESCE(@title_tr, title_tr), overview_tr=COALESCE(@overview_tr, overview_tr)
      WHERE tmdb_id=@tmdb_id
    `).run(row)
    return existing.id
  }
  const result = db.prepare(`
    INSERT INTO ${t.movies} (tmdb_id, title, overview, poster_path, release_date, genres, vote_average, runtime, title_tr, overview_tr)
    VALUES (@tmdb_id, @title, @overview, @poster_path, @release_date, @genres, @vote_average, @runtime, @title_tr, @overview_tr)
  `).run(row)
  return result.lastInsertRowid as number
}

// ── Watchlist ─────────────────────────────────────────────────────────────────

export function addToWatchlist(movieId: number, kind?: Kind): void {
  db.prepare(`INSERT OR IGNORE INTO ${T(kind).watchlist} (movie_id) VALUES (?)`).run(movieId)
}

export function removeFromWatchlist(movieId: number, kind?: Kind): void {
  db.prepare(`DELETE FROM ${T(kind).watchlist} WHERE movie_id = ?`).run(movieId)
}

export interface WatchlistRow extends MovieRow {
  watchlist_id: number
  added_at: string
}

export function getWatchlist(kind?: Kind): WatchlistRow[] {
  const t = T(kind)
  return db.prepare(`
    SELECT w.id as watchlist_id, w.added_at, m.*
    FROM ${t.watchlist} w
    JOIN ${t.movies} m ON m.id = w.movie_id
    ORDER BY w.added_at DESC
  `).all() as WatchlistRow[]
}

export function isInWatchlist(tmdbId: number, kind?: Kind): boolean {
  const t = T(kind)
  return !!db.prepare(`
    SELECT 1 FROM ${t.watchlist} w JOIN ${t.movies} m ON m.id = w.movie_id WHERE m.tmdb_id = ?
  `).get(tmdbId)
}

// ── Watch Log ─────────────────────────────────────────────────────────────────

export interface WatchLogRow extends MovieRow {
  log_id: number
  remote_id: string | null
  watched_at: string
  rating: number | null
  notes: string | null
}

export function addWatchLog(
  movieId: number, watchedAt: string, rating: number | null, notes: string | null,
  remoteId: string | null = null, kind?: Kind
): void {
  const t = T(kind)
  if (remoteId && db.prepare(`SELECT 1 FROM ${t.log} WHERE remote_id = ?`).get(remoteId)) return
  db.prepare(`INSERT INTO ${t.log} (movie_id, watched_at, rating, notes, remote_id) VALUES (?, ?, ?, ?, ?)`)
    .run(movieId, watchedAt, rating, notes, remoteId)
}

// An entry that arrived from Firestore (logged on the phone, or already pushed from here).
// Returns true only if a new row was inserted.
export function addRemoteWatchLog(
  remoteId: string, movie: Omit<MovieRow, 'id'>, watchedAt: string, rating: number | null, notes: string | null,
  kind?: Kind
): boolean {
  const t = T(kind)
  const run = db.transaction((): boolean => {
    // Always refresh the movie row (a later sync can bring e.g. the Turkish title), even if the entry exists
    const movieId = upsertMovie(movie, kind)
    if (db.prepare(`SELECT 1 FROM ${t.log} WHERE remote_id = ?`).get(remoteId)) return false
    // Logged here before remote ids existed: adopt that row instead of duplicating it
    const legacy = db.prepare(
      `SELECT id FROM ${t.log} WHERE movie_id = ? AND watched_at = ? AND remote_id IS NULL LIMIT 1`
    ).get(movieId, watchedAt) as { id: number } | undefined
    if (legacy) {
      db.prepare(`UPDATE ${t.log} SET remote_id = ? WHERE id = ?`).run(remoteId, legacy.id)
      return false
    }
    db.prepare(`INSERT INTO ${t.log} (movie_id, watched_at, rating, notes, remote_id) VALUES (?, ?, ?, ?, ?)`)
      .run(movieId, watchedAt, rating, notes, remoteId)
    return true
  })
  return run()
}

export function removeWatchLogByRemoteId(remoteId: string, kind?: Kind): void {
  db.prepare(`DELETE FROM ${T(kind).log} WHERE remote_id = ?`).run(remoteId)
}

export function removeWatchLogEntry(logId: number, kind?: Kind): void {
  db.prepare(`DELETE FROM ${T(kind).log} WHERE id = ?`).run(logId)
}

export function isWatched(tmdbId: number, kind?: Kind): boolean {
  const t = T(kind)
  return !!db.prepare(`
    SELECT 1 FROM ${t.log} l JOIN ${t.movies} m ON m.id = l.movie_id WHERE m.tmdb_id = ?
  `).get(tmdbId)
}

export function getWatchLog(kind?: Kind): WatchLogRow[] {
  const t = T(kind)
  return db.prepare(`
    SELECT l.id as log_id, l.remote_id, l.watched_at, l.rating, l.notes, m.*
    FROM ${t.log} l
    JOIN ${t.movies} m ON m.id = l.movie_id
    ORDER BY l.watched_at DESC
  `).all() as WatchLogRow[]
}

export function getWatchLogByDate(kind?: Kind): { date: string; titles: string[]; titles_tr: (string | null)[]; posters: (string | null)[] }[] {
  const t = T(kind)
  const rows = db.prepare(`
    SELECT l.watched_at as date, m.title, m.title_tr, m.poster_path
    FROM ${t.log} l
    JOIN ${t.movies} m ON m.id = l.movie_id
    ORDER BY l.watched_at
  `).all() as { date: string; title: string; title_tr: string | null; poster_path: string | null }[]

  const map = new Map<string, { titles: string[]; titles_tr: (string | null)[]; posters: (string | null)[] }>()
  for (const row of rows) {
    const key = row.date.substring(0, 10)
    if (!map.has(key)) map.set(key, { titles: [], titles_tr: [], posters: [] })
    map.get(key)!.titles.push(row.title)
    map.get(key)!.titles_tr.push(row.title_tr)
    map.get(key)!.posters.push(row.poster_path)
  }
  return Array.from(map.entries()).map(([date, { titles, titles_tr, posters }]) => ({ date, titles, titles_tr, posters }))
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export interface StatsResult {
  total_watched: number
  this_month: number
  this_year: number
  this_week: number
  avg_rating: number | null
  favorite_genre: string | null
  watchlist_count: number
}

export function getStats(kind?: Kind): StatsResult {
  const t = T(kind)
  const now = new Date()
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const yearStart = `${now.getFullYear()}-01-01`
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10)

  const total = (db.prepare(`SELECT COUNT(*) as c FROM ${t.log}`).get() as { c: number }).c
  const thisMonth = (db.prepare(`SELECT COUNT(*) as c FROM ${t.log} WHERE watched_at >= ?`).get(monthStart) as { c: number }).c
  const thisYear = (db.prepare(`SELECT COUNT(*) as c FROM ${t.log} WHERE watched_at >= ?`).get(yearStart) as { c: number }).c
  const thisWeek = (db.prepare(`SELECT COUNT(*) as c FROM ${t.log} WHERE watched_at >= ?`).get(weekAgo) as { c: number }).c
  const ratingRow = db.prepare(`SELECT AVG(CAST(rating AS REAL)) as avg FROM ${t.log} WHERE rating IS NOT NULL`).get() as { avg: number | null }
  const watchlistCount = (db.prepare(`SELECT COUNT(*) as c FROM ${t.watchlist}`).get() as { c: number }).c

  const genreRows = db.prepare(`
    SELECT m.genres FROM ${t.log} l JOIN ${t.movies} m ON m.id = l.movie_id
  `).all() as { genres: string }[]

  const genreCount = new Map<string, number>()
  for (const row of genreRows) {
    try {
      const genres: string[] = JSON.parse(row.genres || '[]')
      for (const g of genres) genreCount.set(g, (genreCount.get(g) || 0) + 1)
    } catch { /* skip malformed */ }
  }

  let favoriteGenre: string | null = null
  let maxCount = 0
  for (const [genre, count] of genreCount) {
    if (count > maxCount) { maxCount = count; favoriteGenre = genre }
  }

  return { total_watched: total, this_month: thisMonth, this_year: thisYear, this_week: thisWeek, avg_rating: ratingRow.avg, favorite_genre: favoriteGenre, watchlist_count: watchlistCount }
}

export function getDetailedStats(kind?: Kind): unknown {
  const stats = getStats(kind)
  const recent = getWatchLog(kind).slice(0, 20).map(r => ({ title: r.title, watched_at: r.watched_at, rating: r.rating }))
  return { ...stats, recent }
}
