import { ipcMain, net } from 'electron'
import {
  addToWatchlist, removeFromWatchlist, getWatchlist, upsertMovie,
  addWatchLog, getWatchLog, getWatchLogByDate, getStats,
  getConfig, setConfig, isInWatchlist, getDetailedStats,
  isWatched, removeWatchLogEntry, addRemoteWatchLog, removeWatchLogByRemoteId,
  Kind
} from './database'

// ── Electron net.fetch — never blocked by Windows Firewall ───────────────────

async function netFetch(url: string, options?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<unknown> {
  const res = await net.fetch(url, options)
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
  return res.json()
}

type GeminiTextResponse = { candidates?: { content?: { parts?: { text?: string }[] } }[] }

// ── Default API keys ──────────────────────────────────────────────────────────
// Come from .env at build time (MAIN_VITE_*, not in git). Keys saved in Settings take priority.
const TMDB_KEY_DEFAULT = import.meta.env.MAIN_VITE_TMDB_KEY ?? ''
const GEMINI_KEY_DEFAULT = import.meta.env.MAIN_VITE_GEMINI_KEY ?? ''

function getTmdbKey(): string { return getConfig('tmdb_api_key') || TMDB_KEY_DEFAULT }
function getGeminiKey(): string { return getConfig('gemini_api_key') || GEMINI_KEY_DEFAULT }

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

async function tmdbFetch(path: string): Promise<unknown> {
  const key = getTmdbKey()
  const url = `https://api.themoviedb.org/3${path}${path.includes('?') ? '&' : '?'}api_key=${key}`
  return netFetch(url)
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

  // Together: let Gemini pick (net.fetch — not blocked by the firewall)
  ipcMain.handle('together:resolve', async (_e, data: {
    kind?: string
    geminiPrompt: string
    creatorUsername: string
    partnerUsername: string
    creatorList: MovieInput[]
    partnerList: MovieInput[]
  }) => {
    const k = kindOf(data.kind)
    console.log('=== TOGETHER RESOLVE — IPC START ===', k)

    const key = getGeminiKey()
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`

    let response: GeminiTextResponse | null = null

    // Retry up to 3 times for 503 errors
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        response = await netFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: data.geminiPrompt }] }],
            generationConfig: { maxOutputTokens: 8192, temperature: 0.4 }
          })
        }) as GeminiTextResponse
        break // success
      } catch (e) {
        const msg = String(e)
        if (msg.includes('503') && attempt < 3) {
          console.log(`Gemini 503 — retrying in ${attempt * 2}s (attempt ${attempt}/3)`)
          await new Promise(r => setTimeout(r, attempt * 2000))
        } else {
          console.error('GEMINI FETCH ERROR:', e)
          return null
        }
      }
    }

    if (!response) return null

    const raw = (response.candidates?.[0]?.content?.parts ?? []).map(p => p.text ?? '').join('').trim()
    console.log('GEMINI RAW TEXT:\n', raw)

    // Parse the JSON format: { recommended_movie: { title, year, genre, reasoning, source } }
    let parsed: {
      recommended_movie: {
        title: string
        year: string
        genre: string
        reasoning: string
        source: string
      }
    } | null = null

    try {
      parsed = JSON.parse(raw.replace(/```json|```/g, '').trim())
      console.log('PARSED RESULT:', JSON.stringify(parsed, null, 2))
    } catch (e) {
      console.error('JSON PARSE ERROR:', e, '\nRaw was:', raw)
      return null
    }

    const rec = parsed?.recommended_movie
    if (!rec?.title) {
      console.log('No title in response — returning null')
      return null
    }

    const reasoning = rec.reasoning || ''

    // Map source to actual usernames
    type SourceType = 'Both Watchlists' | 'Host Watchlist' | 'User2 Watchlist' | 'Gemini Recommendation'
    let source: SourceType = 'Gemini Recommendation'
    let sourceLabel = 'Gemini Recommendation'

    if (rec.source === 'Both Watchlists') {
      source = 'Both Watchlists'
      sourceLabel = `In both watchlists`
    } else if (rec.source.includes(data.creatorUsername)) {
      source = 'Host Watchlist'
      sourceLabel = `From ${data.creatorUsername}'s watchlist`
    } else if (rec.source.includes(data.partnerUsername)) {
      source = 'User2 Watchlist'
      sourceLabel = `From ${data.partnerUsername}'s watchlist`
    }

    // Try to find the title in the watchlists first (real data with poster etc.). Exact match only.
    const allMovies = [...data.creatorList, ...data.partnerList]
    const titleLower = rec.title.trim().toLowerCase()
    const found = allMovies.find(m => (m.title || '').toLowerCase() === titleLower)

    if (found) {
      console.log('Found in watchlist:', found.title)
      return { ...found, source, sourceLabel, reasoning }
    }

    // Not in watchlists — search TMDB
    console.log('Not in watchlists, searching TMDB for:', rec.title)
    const tmdbSearch = await tmdbFetch(`/search/${k}?query=${encodeURIComponent(rec.title)}&language=en-US`) as { results: TmdbItem[] }
    const m = tmdbSearch.results?.[0]
    if (!m) {
      console.log('Not found on TMDB either')
      return null
    }

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

  // AI Chat (via net.fetch — no firewall issues)
  ipcMain.handle('ai:chat', async (_e, messages: { role: string; parts: { text: string }[] }[], watchlistData?: unknown[], statsData?: unknown, kind?: string, language?: string) => {
    const k = kindOf(kind)
    const noun = k === 'tv' ? 'TV series' : 'movies'
    const turkish = language === 'tr-TR'
    const suggestedMovies: unknown[] = []

    // Build watchlist context string
    let watchlistContext = ''
    if (watchlistData && Array.isArray(watchlistData) && watchlistData.length > 0) {
      const titles = (watchlistData as { title: string; title_tr?: string | null; genres?: string[]; vote_average?: number }[])
        .map(m => `- ${turkish && m.title_tr ? m.title_tr : m.title}${m.genres?.length ? ` (${m.genres.slice(0,2).join(', ')})` : ''}${m.vote_average ? ` ★${Number(m.vote_average).toFixed(1)}` : ''}`)
        .join('\n')
      watchlistContext = `\n\nUser's current watchlist:\n${titles}`
    } else {
      watchlistContext = `\n\nUser has no ${noun} in their watchlist yet.`
    }

    // Build stats context
    let statsContext = ''
    if (statsData) {
      const s = statsData as { total_watched?: number; favorite_genre?: string; avg_rating?: number }
      statsContext = `\n\nUser's watch stats: ${s.total_watched ?? 0} ${noun} watched total, favorite genre: ${s.favorite_genre ?? 'unknown'}, average rating: ${s.avg_rating ? Number(s.avg_rating).toFixed(1) : 'N/A'}.`
    }

    // Build conversation history
    const history = messages.map(m =>
      `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.parts.map(p => p.text).join(' ')}`
    ).join('\n')

    const brand = k === 'tv' ? 'DiziTrack' : 'CinemaTrack'
    const systemPrompt = `You are ${brand} AI, a friendly ${k === 'tv' ? 'TV series' : 'movie'} assistant. You have access to the user's watchlist and stats below. Help them discover ${noun}, pick from their watchlist, or answer questions about their watch history. Be concise and friendly. ${turkish ? 'Always answer in Turkish.' : 'Answer in English.'}${watchlistContext}${statsContext}`

    const fullPrompt = `${systemPrompt}\n\nConversation:\n${history}\nAssistant:`

    const key = getGeminiKey()
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`

    const body = {
      contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
      // Thinking tokens count against maxOutputTokens on gemini-2.5-flash: switch thinking off for chat
      generationConfig: { temperature: 0.9, maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 } }
    }

    // Gemini answers 503 ("high demand") now and then: retry a couple of times
    let response: GeminiTextResponse | null = null
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        response = await netFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }) as GeminiTextResponse
        break
      } catch (e) {
        const retryable = String(e).includes('503') || String(e).includes('429')
        if (!retryable || attempt === 3) throw e
        await new Promise(r => setTimeout(r, attempt * 1500))
      }
    }

    const text = (response?.candidates?.[0]?.content?.parts ?? []).map(p => p.text ?? '').join('').trim()
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
