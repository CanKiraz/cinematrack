import { useState, useEffect, useCallback, useRef } from 'react'
import MovieCard from '../components/MovieCard'
import MovieDetailModal from '../components/MovieDetailModal'
import { Kind, Movie, WatchlistEntry } from '../types'
import { syncUid } from '../services/auth'
import { syncAddMovie, syncRemoveMovie, syncAddWatchLog } from '../services/sync'
import { onDataChanged } from '../services/events'
import { useI18n, titleOf, overviewOf, genreLabel, Lang } from '../services/i18n'

// ── Watched modal ─────────────────────────────────────────────────────────────

function WatchedModal({ movie, lang, onClose, onConfirm, alreadyWatched }: {
  movie: Movie
  lang: Lang
  onClose: () => void
  onConfirm: (rating: number | null, notes: string) => void
  alreadyWatched?: boolean
}) {
  const { t } = useI18n()
  const [rating, setRating] = useState<number | null>(null)
  const [notes, setNotes] = useState('')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-sm mx-4 p-5 shadow-2xl">
        {alreadyWatched && (
          <div className="mb-4 px-3 py-2 bg-yellow-900/40 border border-yellow-700 rounded-lg text-xs text-yellow-300">
            {t('⚠️ You already watched this. Did you watch it again?')}
          </div>
        )}
        <h3 className="text-white font-semibold text-base mb-0.5">{t('Log as watched')}</h3>
        <p className="text-xs text-zinc-400 mb-5 line-clamp-1">"{titleOf(movie, lang)}"</p>
        <div className="mb-4">
          <label className="text-xs text-zinc-300 font-medium mb-2 block">{t('Rating (optional)')}</label>
          <div className="flex gap-1">
            {[1,2,3,4,5,6,7,8,9,10].map(n => (
              <button key={n} onClick={() => setRating(rating === n ? null : n)}
                className={`w-7 h-7 rounded-md text-xs font-bold transition-colors cursor-pointer ${rating !== null && n <= rating ? 'bg-yellow-500 text-black' : 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600'}`}>
                {n}
              </button>
            ))}
          </div>
        </div>
        <div className="mb-5">
          <label className="text-xs text-zinc-300 font-medium mb-1.5 block">{t('Notes (optional)')}</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('What did you think?')} rows={2}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500 resize-none" />
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-zinc-700 text-sm text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer">{t('Cancel')}</button>
          <button onClick={() => onConfirm(rating, notes)} className="flex-1 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-sm font-semibold text-white transition-colors cursor-pointer">
            {alreadyWatched ? t('Yes, log again') : t('Mark Watched')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Confirm add-already-watched modal ─────────────────────────────────────────

function AlreadyWatchedConfirm({ title, onCancel, onConfirm }: {
  title: string; onCancel: () => void; onConfirm: () => void
}) {
  const { t } = useI18n()
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-sm mx-4 p-5 shadow-2xl">
        <p className="text-base font-semibold text-white mb-2">{t('Already Watched')}</p>
        <p className="text-sm text-zinc-300 mb-5">
          {t('You already watched')} <span className="text-white font-medium">"{title}"</span>. {t('Do you still want to add it to your list?')}
        </p>
        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 py-2 rounded-xl border border-zinc-700 text-sm text-zinc-300 hover:bg-zinc-800 cursor-pointer">{t('Cancel')}</button>
          <button onClick={onConfirm} className="flex-1 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm font-semibold text-white cursor-pointer">{t('Add Anyway')}</button>
        </div>
      </div>
    </div>
  )
}

// ── List row (compact view) ───────────────────────────────────────────────────

function MovieListRow({ movie, lang, onMarkWatched, onRemove, onClick }: {
  movie: WatchlistEntry; lang: Lang; onMarkWatched: () => void; onRemove: () => void; onClick: () => void
}) {
  const posterUrl = movie.poster_path ? `https://image.tmdb.org/t/p/w92${movie.poster_path}` : null
  const year = movie.release_date ? movie.release_date.substring(0, 4) : '—'
  const rating = movie.vote_average ? Number(movie.vote_average).toFixed(1) : null
  const title = titleOf(movie, lang)
  return (
    <div className="flex items-center gap-3 p-3 bg-zinc-800 border border-zinc-700 rounded-xl hover:border-zinc-600 transition-all cursor-pointer group" onClick={onClick}>
      {posterUrl
        ? <img src={posterUrl} alt={title} className="w-10 h-14 object-cover rounded-lg shrink-0" />
        : <div className="w-10 h-14 bg-zinc-700 rounded-lg shrink-0 flex items-center justify-center text-zinc-500">🎬</div>}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white truncate">{title}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-xs text-zinc-400">{year}</span>
          {rating && <span className="text-xs text-yellow-400">★ {rating}</span>}
          {movie.genres?.slice(0, 2).map(g => (
            <span key={g} className="text-xs px-1.5 py-0.5 bg-zinc-700 text-zinc-400 rounded">{genreLabel(g, lang)}</span>
          ))}
        </div>
        <p className="text-xs text-zinc-500 mt-1 line-clamp-1">{overviewOf(movie, lang)}</p>
      </div>
      <div className="flex gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
        <button onClick={onMarkWatched} className="px-2.5 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-medium cursor-pointer">✓</button>
        <button onClick={onRemove} className="px-2.5 py-1.5 rounded-lg bg-zinc-700 hover:bg-red-900/70 text-zinc-400 hover:text-red-300 text-xs cursor-pointer">✕</button>
      </div>
    </div>
  )
}

// ── Genre filter dropdown ─────────────────────────────────────────────────────

function GenreDropdown({ genres, selected, onChange, lang }: {
  genres: string[]; selected: string[]; onChange: (g: string[]) => void; lang: Lang
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function toggle(g: string) {
    onChange(selected.includes(g) ? selected.filter(x => x !== g) : [...selected, g])
  }

  const label = selected.length === 0 ? t('All Genres') : selected.length === 1 ? genreLabel(selected[0], lang) : t('{0} Genres', selected.length)

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
          selected.length > 0 ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
        }`}>
        🎭 {label} <span className="text-xs opacity-70">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-40 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-2 min-w-[180px] max-h-72 overflow-y-auto">
          <button onClick={() => { onChange([]); setOpen(false) }}
            className={`w-full text-left px-3 py-1.5 rounded-lg text-xs font-medium mb-1 transition-colors cursor-pointer ${
              selected.length === 0 ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
            }`}>
            {t('All Genres')}
          </button>
          {genres.map(g => (
            <button key={g} onClick={() => toggle(g)}
              className={`w-full text-left px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center justify-between ${
                selected.includes(g) ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
              }`}>
              {genreLabel(g, lang)}
              {selected.includes(g) && <span className="text-xs">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Sort ──────────────────────────────────────────────────────────────────────

type SortKey = 'added_desc' | 'added_asc' | 'name_asc' | 'name_desc' | 'year_desc' | 'year_asc' | 'rating_desc'

function sortMovies(movies: WatchlistEntry[], key: SortKey, lang: Lang): WatchlistEntry[] {
  const locale = lang === 'tr' ? 'tr' : 'en'
  return [...movies].sort((a, b) => {
    switch (key) {
      case 'added_desc': return b.watchlist_id - a.watchlist_id
      case 'added_asc':  return a.watchlist_id - b.watchlist_id
      case 'name_asc':   return titleOf(a, lang).localeCompare(titleOf(b, lang), locale)
      case 'name_desc':  return titleOf(b, lang).localeCompare(titleOf(a, lang), locale)
      case 'year_desc':  return (b.release_date || '').localeCompare(a.release_date || '')
      case 'year_asc':   return (a.release_date || '').localeCompare(b.release_date || '')
      case 'rating_desc':return (b.vote_average || 0) - (a.vote_average || 0)
    }
  })
}

// ── Main Watchlist page ───────────────────────────────────────────────────────

type ViewMode = 'grid' | 'list'

export default function Watchlist({ kind }: { kind: Kind }) {
  const { t, lang, tmdbLang } = useI18n()
  const [watchlist, setWatchlist]     = useState<WatchlistEntry[]>([])
  const [tab, setTab]                 = useState<'list' | 'search'>('list')
  const [viewMode, setViewMode]       = useState<ViewMode>('grid')
  const [sortKey, setSortKey]         = useState<SortKey>('added_desc')
  const [query, setQuery]             = useState('')
  const [searchResults, setResults]   = useState<Movie[]>([])
  const [searching, setSearching]     = useState(false)
  const [selectedGenres, setGenres]   = useState<string[]>([])
  const [watchedModal, setWatchedModal] = useState<{ movie: Movie; alreadyWatched: boolean } | null>(null)
  const [detailMovie, setDetailMovie] = useState<Movie | null>(null)
  const [detailIsWatchlist, setDetailIsWatchlist] = useState(false)
  const [confirmAdd, setConfirmAdd]   = useState<Movie | null>(null)
  const [error, setError]             = useState<string | null>(null)

  const isTv = kind === 'tv'
  const sortOptions: { value: SortKey; label: string }[] = [
    { value: 'added_desc', label: t('Date Added ↓') },
    { value: 'added_asc',  label: t('Date Added ↑') },
    { value: 'name_asc',   label: t('Name A → Z') },
    { value: 'name_desc',  label: t('Name Z → A') },
    { value: 'year_desc',  label: t('Year (Newest)') },
    { value: 'year_asc',   label: t('Year (Oldest)') },
    { value: 'rating_desc',label: t('Rating ↓') },
  ]

  const loadWatchlist = useCallback(async () => {
    const data = await window.api.getWatchlist(kind)
    setWatchlist(data)
  }, [kind])

  useEffect(() => { loadWatchlist() }, [loadWatchlist])
  // titles added/removed on the phone arrive in the background: refresh while the page is open
  useEffect(() => onDataChanged(() => { loadWatchlist() }), [loadWatchlist])

  const allGenres = [...new Set(watchlist.flatMap(m => m.genres || []))].sort()

  const needle = query.toLowerCase()
  const filtered = sortMovies(
    watchlist.filter(m =>
      (selectedGenres.length === 0 || selectedGenres.some(g => m.genres?.includes(g))) &&
      (!query || m.title.toLowerCase().includes(needle) || titleOf(m, lang).toLowerCase().includes(needle))
    ),
    sortKey, lang
  )

  function openDetail(movie: Movie, inWl: boolean) {
    setDetailMovie(movie); setDetailIsWatchlist(inWl)
  }

  async function doSearch() {
    if (!query.trim()) return
    setSearching(true); setError(null)
    try {
      const results = await window.api.searchMovies(query, kind, tmdbLang)
      const detailed = await Promise.all(results.slice(0, 12).map(async m => {
        try { return await window.api.getMovie(m.tmdb_id, kind) } catch { return m }
      }))
      setResults(detailed)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Search failed'))
    } finally { setSearching(false) }
  }

  async function addMovie(movie: Movie) {
    // Check if already watched
    const watched = await window.api.isWatched(movie.tmdb_id, kind)
    if (watched) { setConfirmAdd(movie); return }
    await window.api.addToWatchlist(movie, kind)
    const uid = syncUid()
    if (uid) await syncAddMovie(uid, movie, kind).catch(() => {})
    await loadWatchlist()
  }

  async function addMovieForce(movie: Movie) {
    await window.api.addToWatchlist(movie, kind)
    const uid = syncUid()
    if (uid) await syncAddMovie(uid, movie, kind).catch(() => {})
    await loadWatchlist()
    setConfirmAdd(null)
  }

  async function removeMovie(movieId: number) {
    const entry = watchlist.find(m => m.id === movieId)
    await window.api.removeFromWatchlist(movieId, kind)
    if (entry) {
      const uid = syncUid()
      if (uid) await syncRemoveMovie(uid, entry.tmdb_id, kind).catch(() => {})
    }
    setWatchlist(prev => prev.filter(m => m.id !== movieId))
  }

  async function openWatchedModal(movie: Movie) {
    const alreadyWatched = await window.api.isWatched(movie.tmdb_id, kind)
    setWatchedModal({ movie, alreadyWatched })
  }

  async function logWatched(movie: Movie, rating: number | null, notes: string) {
    const today = new Date().toLocaleDateString('sv-SE')   // local YYYY-MM-DD (toISOString is UTC: after midnight it gave yesterday)
    const uid = syncUid()
    // Upsert movie first (for search results that aren't in DB yet)
    await window.api.addToWatchlist(movie, kind)
    if (uid) await syncAddMovie(uid, movie, kind).catch(() => {})
    const wl = await window.api.getWatchlist(kind)
    const entry = wl.find(m => m.tmdb_id === movie.tmdb_id)
    if (entry) {
      // One id for both stores, so the Firestore listener recognises this entry as already logged
      const logId = `${uid ?? 'local'}_${movie.tmdb_id}_${Date.now()}`
      await window.api.addWatchLog({ movieId: entry.id, watchedAt: today, rating, notes: notes || null, remoteId: uid ? logId : null }, kind)
      // Sync watch log to Firestore
      if (uid) {
        await syncAddWatchLog(uid, {
          log_id: logId,
          tmdb_id: movie.tmdb_id,
          title: movie.title,
          overview: movie.overview,
          poster_path: movie.poster_path,
          release_date: movie.release_date,
          genres: movie.genres,
          vote_average: movie.vote_average,
          runtime: movie.runtime ?? null,
          watched_at: today,
          rating,
          notes: notes || null,
          title_tr: movie.title_tr ?? null,
          overview_tr: movie.overview_tr ?? null
        }, kind).catch(() => {})
      }
      // Remove from watchlist after logging
      await window.api.removeFromWatchlist(entry.id, kind)
      if (uid) await syncRemoveMovie(uid, movie.tmdb_id, kind).catch(() => {})
    }
    await loadWatchlist()
    setWatchedModal(null)
  }

  const inWatchlist = (tmdbId: number) => watchlist.some(m => m.tmdb_id === tmdbId)

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-zinc-800 px-6 pt-8 pb-4 shrink-0">
        <h1 className="text-2xl font-bold text-white">{isTv ? t('Series List') : t('Watchlist')}</h1>
        <p className="text-sm text-zinc-400 mt-0.5">
          {isTv
            ? t('{0} series waiting', watchlist.length)
            : t('{0} movies waiting', watchlist.length)}
        </p>

        <div className="flex items-center justify-between mt-4 mb-3">
          <div className="flex gap-1">
            {(['list', 'search'] as const).map(tabId => (
              <button key={tabId} onClick={() => { setTab(tabId); setQuery('') }}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${tab === tabId ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>
                {tabId === 'list' ? t('My List') : isTv ? t('+ Add Series') : t('+ Add Movies')}
              </button>
            ))}
          </div>
          {tab === 'list' && (
            <div className="flex items-center gap-2">
              {/* Sort dropdown */}
              <select value={sortKey} onChange={e => setSortKey(e.target.value as SortKey)}
                className="bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded-lg px-2 py-1.5 focus:outline-none cursor-pointer">
                {sortOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              {/* Grid/List toggle */}
              <div className="flex gap-1 bg-zinc-800 rounded-lg p-0.5">
                <button onClick={() => setViewMode('grid')} title={t('Grid view')}
                  className={`px-2.5 py-1 rounded-md text-sm transition-colors cursor-pointer ${viewMode === 'grid' ? 'bg-zinc-600 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>⊞</button>
                <button onClick={() => setViewMode('list')} title={t('List view')}
                  className={`px-2.5 py-1 rounded-md text-sm transition-colors cursor-pointer ${viewMode === 'list' ? 'bg-zinc-600 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>☰</button>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm pointer-events-none">🔍</span>
            <input type="text" value={query} onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && tab === 'search') doSearch() }}
              placeholder={tab === 'list' ? t('Filter by title…') : isTv ? t('Search for series to add…') : t('Search for movies to add…')}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl pl-9 pr-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-blue-500 transition-colors" />
          </div>
          {tab === 'search' && (
            <button onClick={doSearch} disabled={searching || !query.trim()}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold text-white transition-colors cursor-pointer shrink-0">
              {searching ? '…' : t('Search')}
            </button>
          )}
        </div>
      </div>

      {/* Genre filter (list tab) */}
      {tab === 'list' && allGenres.length > 0 && (
        <div className="flex items-center gap-2 px-6 py-2.5 border-b border-zinc-800 shrink-0">
          <GenreDropdown genres={allGenres} selected={selectedGenres} onChange={setGenres} lang={lang} />
          {selectedGenres.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selectedGenres.map(g => (
                <span key={g} className="flex items-center gap-1 text-xs px-2 py-0.5 bg-blue-900/50 border border-blue-700 text-blue-300 rounded-full">
                  {genreLabel(g, lang)}
                  <button onClick={() => setGenres(selectedGenres.filter(x => x !== g))} className="hover:text-white cursor-pointer">✕</button>
                </span>
              ))}
              <button onClick={() => setGenres([])} className="text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer">{t('Clear all')}</button>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="mx-6 mt-3 px-3 py-2 bg-red-900/30 border border-red-800 rounded-lg text-xs text-red-300">{error}</div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {tab === 'list' ? (
          filtered.length > 0 ? (
            viewMode === 'grid' ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {filtered.map(movie => (
                  <MovieCard key={movie.watchlist_id} movie={movie}
                    onMarkWatched={() => openWatchedModal(movie)}
                    onRemove={() => removeMovie(movie.id)}
                    showRemove onClick={() => openDetail(movie, true)} />
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {filtered.map(movie => (
                  <MovieListRow key={movie.watchlist_id} movie={movie} lang={lang}
                    onMarkWatched={() => openWatchedModal(movie)}
                    onRemove={() => removeMovie(movie.id)}
                    onClick={() => openDetail(movie, true)} />
                ))}
              </div>
            )
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-500 pb-16">
              <span className="text-5xl">{isTv ? '📺' : '🎬'}</span>
              <p className="text-sm text-center max-w-xs">
                {watchlist.length === 0
                  ? (isTv ? t('Your series list is empty. Switch to "Add Series" to find something!') : t('Your watchlist is empty. Switch to "Add Movies" to find something!'))
                  : t('Nothing matches your filter.')}
              </p>
            </div>
          )
        ) : (
          searchResults.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {searchResults.map(movie => (
                <MovieCard key={movie.tmdb_id} movie={movie}
                  onAdd={() => addMovie(movie)}
                  onMarkWatched={() => openWatchedModal(movie)}
                  added={inWatchlist(movie.tmdb_id)}
                  onClick={() => openDetail(movie, inWatchlist(movie.tmdb_id))} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-500 pb-16">
              <span className="text-5xl">🔍</span>
              <p className="text-sm">{isTv ? t('Search for a series title, genre, or actor') : t('Search for a movie title, genre, or actor')}</p>
            </div>
          )
        )}
      </div>

      {/* Watched modal */}
      {watchedModal && (
        <WatchedModal movie={watchedModal.movie} lang={lang} alreadyWatched={watchedModal.alreadyWatched}
          onClose={() => setWatchedModal(null)}
          onConfirm={(r, n) => logWatched(watchedModal.movie, r, n)} />
      )}

      {/* Already watched confirm */}
      {confirmAdd && (
        <AlreadyWatchedConfirm title={titleOf(confirmAdd, lang)}
          onCancel={() => setConfirmAdd(null)}
          onConfirm={() => addMovieForce(confirmAdd)} />
      )}

      {/* Detail modal */}
      {detailMovie && (
        <MovieDetailModal
          kind={kind}
          movie={detailMovie}
          onClose={() => setDetailMovie(null)}
          onAdd={!detailIsWatchlist ? () => addMovie(detailMovie) : undefined}
          onRemove={detailIsWatchlist && 'id' in detailMovie ? () => removeMovie((detailMovie as WatchlistEntry).id) : undefined}
          onMarkWatched={detailIsWatchlist && 'id' in detailMovie ? () => { setDetailMovie(null); openWatchedModal(detailMovie) } : undefined}
          onLogWatched={!detailIsWatchlist ? () => { setDetailMovie(null); openWatchedModal(detailMovie) } : undefined}
          inWatchlist={detailIsWatchlist}
        />
      )}
    </div>
  )
}
