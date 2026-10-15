// ── Core movie types ─────────────────────────────────────────────────────────

// CinemaTrack tracks movies, DiziTrack tracks TV series. Same shapes, different tables/collections.
export type Kind = 'movie' | 'tv'

export interface Movie {
  id?: number          // internal DB id (undefined for search results)
  tmdb_id: number
  title: string
  overview: string
  poster_path: string | null
  release_date: string
  genres: string[]
  vote_average: number
  runtime?: number | null
  title_tr?: string | null      // Turkish title/overview (empty = TMDB has none)
  overview_tr?: string | null
}

export interface WatchlistEntry extends Movie {
  id: number           // always set for watchlist entries
  watchlist_id: number
  added_at: string
}

export interface WatchLogEntry extends Movie {
  id: number
  log_id: number
  remote_id: string | null   // id of the matching Firestore watchlog document
  watched_at: string
  rating: number | null
  notes: string | null
}

export interface Stats {
  total_watched: number
  this_month: number
  this_year: number
  this_week: number
  avg_rating: number | null
  favorite_genre: string | null
  watchlist_count: number
}

export interface HeatmapDay {
  date: string   // "YYYY-MM-DD"
  titles: string[]
  titles_tr?: (string | null)[]
  posters: (string | null)[]
}

export type Page = 'watchlist' | 'stats' | 'ai' | 'together'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  suggestedMovies?: Movie[]
  loading?: boolean
}

// ── Window API (exposed by preload) ──────────────────────────────────────────

declare global {
  interface Window {
    api: {
      getConfig(key: string): Promise<string | null>
      setConfig(key: string, value: string): Promise<void>
      setAuthToken(token: string | null): Promise<void>
      onAuthRefreshRequest(callback: () => void): () => void
      searchMovies(query: string, kind?: Kind, language?: string): Promise<Movie[]>
      getMovie(tmdbId: number, kind?: Kind): Promise<Movie>
      getWatchProviders(tmdbId: number, kind?: Kind): Promise<unknown>
      addToWatchlist(movie: Movie, kind?: Kind): Promise<{ success: boolean }>
      removeFromWatchlist(movieId: number, kind?: Kind): Promise<{ success: boolean }>
      getWatchlist(kind?: Kind): Promise<WatchlistEntry[]>
      checkWatchlist(tmdbId: number, kind?: Kind): Promise<boolean>
      addWatchLog(data: { movieId: number; watchedAt: string; rating: number | null; notes: string | null; remoteId?: string | null }, kind?: Kind): Promise<{ success: boolean }>
      addRemoteWatchLog(data: { remoteId: string; watchedAt: string; rating: number | null; notes: string | null; movie: Movie }, kind?: Kind): Promise<{ success: boolean; added: boolean }>
      removeRemoteWatchLog(remoteId: string, kind?: Kind): Promise<{ success: boolean }>
      isWatched(tmdbId: number, kind?: Kind): Promise<boolean>
      removeWatchLog(logId: number, kind?: Kind): Promise<{ success: boolean }>
      getWatchLog(kind?: Kind): Promise<WatchLogEntry[]>
      getWatchLogByDate(kind?: Kind): Promise<HeatmapDay[]>
      togetherResolve(data: unknown): Promise<unknown>
      getStats(kind?: Kind): Promise<Stats>
      getDetailedStats(kind?: Kind): Promise<unknown>
      aiChat(messages: { role: 'user' | 'model'; parts: { text: string }[] }[], watchlist: Movie[], stats: unknown, kind?: Kind, language?: string): Promise<{ text: string; suggestedMovies: Movie[] }>
    }
  }
}
