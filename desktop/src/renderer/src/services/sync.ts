import { doc, setDoc, deleteDoc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { Kind, Movie } from '../types'

// CinemaTrack (movies) lives in watchlists/{uid}/movies + watchlog,
// DiziTrack (series) in watchlists/{uid}/shows + showlog — the same shape, different collections.
export function collectionNames(kind: Kind): { list: string; log: string } {
  return kind === 'tv' ? { list: 'shows', log: 'showlog' } : { list: 'movies', log: 'watchlog' }
}

// ── Watchlist sync ────────────────────────────────────────────────────────────

export async function syncAddMovie(uid: string, movie: Movie, kind: Kind = 'movie'): Promise<void> {
  const ref = doc(db, 'watchlists', uid, collectionNames(kind).list, String(movie.tmdb_id))
  const data: Record<string, unknown> = {
    tmdb_id: movie.tmdb_id,
    title: movie.title,
    overview: movie.overview,
    poster_path: movie.poster_path ?? null,
    release_date: movie.release_date,
    genres: movie.genres,
    vote_average: movie.vote_average,
    runtime: movie.runtime ?? null
  }
  // The Turkish copy, once known (null = not looked up yet). tr_checked tells the phone not to look it up again.
  if (movie.title_tr != null) {
    data.title_tr = movie.title_tr
    data.overview_tr = movie.overview_tr ?? ''
    data.tr_checked = true
  }
  // merge: keep fields another device added (e.g. the phone's Turkish backfill)
  await setDoc(ref, data, { merge: true })
}

export async function syncRemoveMovie(uid: string, tmdbId: number, kind: Kind = 'movie'): Promise<void> {
  await deleteDoc(doc(db, 'watchlists', uid, collectionNames(kind).list, String(tmdbId)))
}

// ── Watch log sync ────────────────────────────────────────────────────────────

export async function syncAddWatchLog(uid: string, entry: {
  log_id: string
  tmdb_id: number
  title: string
  overview: string
  poster_path: string | null
  release_date: string
  genres: string[]
  vote_average: number
  runtime: number | null
  watched_at: string
  rating: number | null
  notes: string | null
  title_tr?: string | null
  overview_tr?: string | null
}, kind: Kind = 'movie'): Promise<void> {
  const data: Record<string, unknown> = { ...entry }
  if (entry.title_tr != null) {
    data.overview_tr = entry.overview_tr ?? ''
    data.tr_checked = true
  } else {
    delete data.title_tr
    delete data.overview_tr
  }
  await setDoc(doc(db, 'watchlists', uid, collectionNames(kind).log, entry.log_id), data, { merge: true })
}

export async function syncRemoveWatchLog(uid: string, logId: string, kind: Kind = 'movie'): Promise<void> {
  await deleteDoc(doc(db, 'watchlists', uid, collectionNames(kind).log, logId))
}

// ── One-time migration ────────────────────────────────────────────────────────

export async function isMigrated(uid: string): Promise<boolean> {
  try {
    const ref = doc(db, 'watchlists', uid, 'meta', 'migration')
    const snap = await getDoc(ref)
    return snap.exists() && snap.data()?.done === true
  } catch { return false }
}

export async function markMigrated(uid: string): Promise<void> {
  await setDoc(doc(db, 'watchlists', uid, 'meta', 'migration'), { done: true, migratedAt: new Date().toISOString() })
}
