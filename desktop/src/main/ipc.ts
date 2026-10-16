import { ipcMain } from 'electron'
import {
  addToWatchlist, removeFromWatchlist, getWatchlist, upsertMovie,
  addWatchLog, getWatchLog, getWatchLogByDate, getStats,
  getConfig, setConfig, isInWatchlist, getDetailedStats,
  isWatched, removeWatchLogEntry, addRemoteWatchLog, removeWatchLogByRemoteId,
  claimLocalDataFor, setWatchlistAddedAt, Kind
} from './database'
import { api, apiPublic, setAuthToken } from './api'

// ── TMDB ──────────────────────────────────────────────────────────────────────
// CinemaTrack = movies ('movie'), DiziTrack = TV series ('tv'). The two differ only in a few field names.

interface TmdbItem {
  id: number
  title?: string; name?: string                    // movie / tv
  release_date?: string; first_air_date?: string   // movie / tv
  overview: string
  poster_path: string | null; vote_average: number
}
interface TmdbDetail extends TmdbItem {
  genres: { id: number; name: string }[]
  runtime?: number | null                          // movie
  episode_run_time?: number[]                      // tv
  translations?: { translations: { iso_639_1: string; data: { title?: string; name?: string; overview?: string } }[] }
}

function kindOf(kind?: string): Kind { return kind === 'tv' ? 'tv' : 'movie' }

// `path` is the TMDB path ("/search/movie?query=..."); the CinemaTrack API adds the key and enforces the limits
async function tmdbFetch(path: string): Promise<unknown> {
  return api(`/v1/tmdb${path}`)
}

function mapItem(m: TmdbItem, kind: Kind) {
  const tv = kind === 'tv'
  return {
    tmdb_id: m.id, title: (tv ? m.name : m.title) || '', overview: m.overview || '',
    poster_path: m.poster_path, release_date: (tv ? m.first_air_date : m.release_date) || '',
    vote_average: m.vote_average || 0, genres: [] as string[], runtime: null as number | null
  }
}

// Full details in English plus the Turkish copy (title_tr / overview_tr)
function mapDetail(d: TmdbDetail, kind: Kind) {
  const tv = kind === 'tv'
  const base = {
    ...mapItem(d, kind),
    genres: d.genres?.map(g => g.name) || [],
    runtime: (tv ? d.episode_run_time?.[0] : d.runtime) || null
  }
  if (!d.translations) return base
  const tr = d.translations.translations?.find(t => t.iso_639_1 === 'tr')
  return {
    ...base,
    title_tr: (tv ? tr?.data?.name : tr?.data?.title) || '',
    overview_tr: tr?.data?.overview || '',
    tr_checked: true   // looked up once; empty means TMDB has no Turkish text
  }
}

interface MovieInput {
  tmdb_id: number; title: string; overview: string; poster_path: string | null; release_date: string
  genres: string[]; vote_average: number; runtime: number | null
  title_tr?: string | null; overview_tr?: string | null
}

function toRow(m: MovieInput) {
  return {
    tmdb_id: m.tmdb_id, title: m.title, overview: m.overview || '', poster_path: m.poster_path ?? null,
    release_date: m.release_date || '', genres: JSON.stringify(m.genres || []),
    vote_average: m.vote_average || 0, runtime: m.runtime ?? null,
    title_tr: m.title_tr ?? null, overview_tr: m.overview_tr ?? null
  }
}

function lang(l?: string): string { return l === 'tr-TR' ? 'tr-TR' : 'en-US' }

// ── Register IPC handlers ─────────────────────────────────────────────────────
// Every handler that touches movies/series takes an optional trailing `kind` ('movie' by default).

export function registerIpcHandlers(): void {

  ipcMain.handle('config:get', (_e, key: string) => getConfig(key))
  ipcMain.handle('config:set', (_e, key: string, value: string) => setConfig(key, value))

  // Local data belongs to one account: a different account gets a fresh database (see claimLocalDataFor)
  ipcMain.handle('account:claimLocalData', (_e, uid: string) => {
    if (typeof uid !== 'string' || !uid) throw new Error('uid is required')
    return claimLocalDataFor(uid)
  })

  // Is this display name acceptable? Answered by the CinemaTrack API (so the list can change without a new app).
  // If the API cannot be reached the name is let through: a check outage must not stop anybody from signing up.
  ipcMain.handle('names:check', async (_e, name: string) => {
    try {
      return await apiPublic('/v1/names/check', { name })
    } catch {
      return { ok: true }
    }
  })

  // The signed-in user's Firebase ID token, which the renderer pushes here for the CinemaTrack API calls
  ipcMain.handle('auth:setToken', (_e, token: string | null) => setAuthToken(typeof token === 'string' ? token : null))

  // TMDB (via net.fetch — no firewall issues)
  ipcMain.handle('tmdb:search', async (_e, query: string, kind?: string, language?: string) => {
    const k = kindOf(kind)
    const data = await tmdbFetch(`/search/${k}?query=${encodeURIComponent(query)}&language=${lang(language)}`) as { results: TmdbItem[] }
    return (data.results || []).slice(0, 20).map(m => mapItem(m, k))
  })

  ipcMain.handle('tmdb:getMovie', async (_e, tmdbId: number, kind?: string) => {
    const k = kindOf(kind)
    const d = await tmdbFetch(`/${k}/${tmdbId}?language=en-US&append_to_response=translations`) as TmdbDetail
    return mapDetail(d, k)
  })

  // Where a title can be streamed in Turkey (kept in the main process so the key never reaches the UI)
  ipcMain.handle('tmdb:watchProviders', async (_e, tmdbId: number, kind?: string) => {
    const d = await tmdbFetch(`/${kindOf(kind)}/${tmdbId}/watch/providers`) as { results?: Record<string, unknown> }
    return d.results?.TR ?? null
  })

  // Watchlist
  ipcMain.handle('watchlist:add', (_e, movie: MovieInput, kind?: string) => {
    const k = kindOf(kind)
    const movieId = upsertMovie(toRow(movie), k)
    addToWatchlist(movieId, k)
    return { success: true }
  })

  ipcMain.handle('watchlist:remove', (_e, movieId: number, kind?: string) => { removeFromWatchlist(movieId, kindOf(kind)); return { success: true } })

  ipcMain.handle('watchlist:getAll', (_e, kind?: string) => getWatchlist(kindOf(kind)).map(r => ({
    watchlist_id: r.watchlist_id, added_at: r.added_at, id: r.id, tmdb_id: r.tmdb_id,
    title: r.title, overview: r.overview, poster_path: r.poster_path, release_date: r.release_date,
    genres: JSON.parse(r.genres || '[]'), vote_average: r.vote_average, runtime: r.runtime,
    title_tr: r.title_tr ?? null, overview_tr: r.overview_tr ?? null
  })))

  ipcMain.handle('watchlist:check', (_e, tmdbId: number, kind?: string) => isInWatchlist(tmdbId, kindOf(kind)))
  ipcMain.handle('watchlist:setAddedAt', (_e, tmdbId: number, iso: string, kind?: string) =>
    typeof iso === 'string' ? setWatchlistAddedAt(tmdbId, iso, kindOf(kind)) : false)

  // Watch log
  ipcMain.handle('watchlog:isWatched', (_e, tmdbId: number, kind?: string) => isWatched(tmdbId, kindOf(kind)))
  ipcMain.handle('watchlog:remove', (_e, logId: number, kind?: string) => { removeWatchLogEntry(logId, kindOf(kind)); return { success: true } })
  ipcMain.handle('watchlog:add', (_e, data: { movieId: number; watchedAt: string; rating: number | null; notes: string | null; remoteId?: string | null }, kind?: string) => {
    addWatchLog(data.movieId, data.watchedAt, data.rating, data.notes, data.remoteId ?? null, kindOf(kind))
    return { success: true }
  })

  // Watch-log entry that arrived from Firestore. Touches the movies table only — never the watchlist.
  ipcMain.handle('watchlog:addRemote', (_e, data: {
    remoteId: string; watchedAt: string; rating: number | null; notes: string | null; movie: MovieInput
  }, kind?: string) => {
    try {
      const added = addRemoteWatchLog(
        data.remoteId, toRow(data.movie), data.watchedAt, data.rating ?? null, data.notes ?? null, kindOf(kind)
      )
      return { success: true, added }
    } catch (e) {
      console.error('watchlog:addRemote failed:', e)
      return { success: false, added: false }
    }
  })
  ipcMain.handle('watchlog:removeRemote', (_e, remoteId: string, kind?: string) => { removeWatchLogByRemoteId(remoteId, kindOf(kind)); return { success: true } })

  ipcMain.handle('watchlog:getAll', (_e, kind?: string) => getWatchLog(kindOf(kind)).map(r => ({
    log_id: r.log_id, remote_id: r.remote_id, watched_at: r.watched_at, rating: r.rating, notes: r.notes,
    id: r.id, tmdb_id: r.tmdb_id, title: r.title, overview: r.overview,
    poster_path: r.poster_path, release_date: r.release_date,
    genres: JSON.parse(r.genres || '[]'), vote_average: r.vote_average, runtime: r.runtime,
    title_tr: r.title_tr ?? null, overview_tr: r.overview_tr ?? null
  })))

  ipcMain.handle('watchlog:getByDate', (_e, kind?: string) => getWatchLogByDate(kindOf(kind)))

  // Together: the CinemaTrack API builds the prompt, asks Gemini, and returns a pick that suits both people
  ipcMain.handle('together:resolve', async (_e, data: {
    kind?: string
    language?: string
    users: unknown[]               // [creator, partner]: { name, random, prompt, watched, watchlist }
    creatorUsername: string
    partnerUsername: string
    creatorList: MovieInput[]
    partnerList: MovieInput[]
  }) => {
    const k = kindOf(data.kind)

    const answer = await api('/v1/ai/together', {
      method: 'POST',
      body: { kind: k, language: lang(data.language) === 'tr-TR' ? 'tr' : 'en', users: data.users }
    }) as { pick: { title: string; reasoning: string; source: 'both' | 'first' | 'second' | 'gemini' } | null }

    const rec = answer.pick
    if (!rec?.title) return null
    const reasoning = rec.reasoning || ''

    // "first" / "second" follow the order the users were sent: creator, then partner
    type SourceType = 'Both Watchlists' | 'Host Watchlist' | 'User2 Watchlist' | 'Gemini Recommendation'
    let source: SourceType = 'Gemini Recommendation'
    let sourceLabel = 'Gemini Recommendation'
    if (rec.source === 'both') {
      source = 'Both Watchlists'
      sourceLabel = 'In both watchlists'
    } else if (rec.source === 'first') {
      source = 'Host Watchlist'
      sourceLabel = `From ${data.creatorUsername}'s watchlist`
    } else if (rec.source === 'second') {
      source = 'User2 Watchlist'
      sourceLabel = `From ${data.partnerUsername}'s watchlist`
    }

    // Try to find the title in the watchlists first (real data with poster etc.). Exact match only.
    const allMovies = [...data.creatorList, ...data.partnerList]
    const titleLower = rec.title.trim().toLowerCase()
    const found = allMovies.find(m => (m.title || '').toLowerCase() === titleLower)
    if (found) return { ...found, source, sourceLabel, reasoning }

    // Not in the watchlists: look it up on TMDB
    const tmdbSearch = await tmdbFetch(`/search/${k}?query=${encodeURIComponent(rec.title)}&language=en-US`) as { results: TmdbItem[] }
    const m = tmdbSearch.results?.[0]
    if (!m) return null

    const detail = await tmdbFetch(`/${k}/${m.id}?language=en-US&append_to_response=translations`) as TmdbDetail
    return {
      ...mapDetail(detail, k),
      source: 'Gemini Recommendation' as SourceType,
      sourceLabel: 'Gemini Recommendation',
      reasoning
    }
  })

  // Stats
  ipcMain.handle('stats:get', (_e, kind?: string) => getStats(kindOf(kind)))
  ipcMain.handle('stats:getDetailed', (_e, kind?: string) => getDetailedStats(kindOf(kind)))

  // AI Chat: the CinemaTrack API builds the prompt and asks Gemini; titles in the answer are then looked up on TMDB
  ipcMain.handle('ai:chat', async (_e, messages: { role: string; parts: { text: string }[] }[], watchlistData?: unknown[], statsData?: unknown, kind?: string, language?: string) => {
    const k = kindOf(kind)
    const turkish = language === 'tr-TR'
    const suggestedMovies: unknown[] = []

    const stats = (statsData ?? {}) as { total_watched?: number; favorite_genre?: string | null; avg_rating?: number | null }
    const watchlist = (Array.isArray(watchlistData) ? watchlistData : []) as
      { title: string; title_tr?: string | null; genres?: string[]; vote_average?: number }[]

    const reply = await api('/v1/ai/chat', {
      method: 'POST',
      body: {
        kind: k,
        language: turkish ? 'tr' : 'en',
        messages: messages.map(m => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          text: m.parts.map(p => p.text).join(' ')
        })),
        watchlist: watchlist.slice(0, 100).map(m => ({
          title: turkish && m.title_tr ? m.title_tr : m.title,
          genres: m.genres,
          vote_average: m.vote_average
        })),
        stats: { total_watched: stats.total_watched, favorite_genre: stats.favorite_genre, avg_rating: stats.avg_rating }
      }
    }) as { text: string }

    const text = reply.text.trim()
      || (turkish ? 'Üzgünüm, bir cevap üretemedim. Lütfen tekrar dene.' : 'Sorry, I could not come up with an answer. Please try again.')

    // Extract titles and search TMDB for them
    const lines = text.split('\n').filter(l => l.trim())
    for (const line of lines.slice(0, 6)) {
      const match = line.match(/\*\*([^*]+)\*\*|^\d+\.\s+(.+?)[\s\-–:]|^[-•]\s+(.+?)[\s\-–:]/)
      if (match) {
        const title = (match[1] || match[2] || match[3])?.trim()
        if (title && title.length > 2 && title.length < 60) {
          try {
            const data = await tmdbFetch(`/search/${k}?query=${encodeURIComponent(title)}&language=${lang(language)}`) as { results: TmdbItem[] }
            if (data.results?.[0]) suggestedMovies.push(mapItem(data.results[0], k))
          } catch { /* skip */ }
        }
      }
    }

    return { text, suggestedMovies }
  })
}
