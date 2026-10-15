import { Movie } from '../types'
import { useI18n, titleOf, overviewOf, genreLabel } from '../services/i18n'

interface Props {
  movie: Movie
  onAdd?: () => void
  onRemove?: () => void
  onMarkWatched?: () => void
  onClick?: () => void
  added?: boolean
  showRemove?: boolean
  compact?: boolean
}

export default function MovieCard({ movie, onAdd, onRemove, onMarkWatched, onClick, added, showRemove, compact }: Props) {
  const { t, lang } = useI18n()
  const posterUrl = movie.poster_path ? `https://image.tmdb.org/t/p/w300${movie.poster_path}` : null
  const year = movie.release_date ? movie.release_date.substring(0, 4) : '—'
  const rating = movie.vote_average ? Number(movie.vote_average).toFixed(1) : null
  const title = titleOf(movie, lang)
  const overview = overviewOf(movie, lang)

  // ── Compact mode (used in AI chat sidebar) ───────────────────────────────
  if (compact) {
    return (
      <div className="flex gap-3 p-3 bg-zinc-800 border border-zinc-700 rounded-xl">
        {posterUrl ? (
          <img src={posterUrl} alt={title} className="w-12 h-[68px] object-cover rounded-lg shrink-0" />
        ) : (
          <div className="w-12 h-[68px] bg-zinc-700 rounded-lg shrink-0 flex items-center justify-center text-zinc-500 text-lg">🎬</div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white truncate">{title}</p>
          <p className="text-xs text-zinc-400">{year}{rating ? ` · ★ ${rating}` : ''}</p>
          {movie.genres && movie.genres.length > 0 && (
            <p className="text-xs text-zinc-500 mt-0.5">{movie.genres.slice(0, 2).map(g => genreLabel(g, lang)).join(', ')}</p>
          )}
          <p className="text-xs text-zinc-400 line-clamp-2 mt-1 leading-relaxed">{overview}</p>
          {onAdd && (
            <button
              onClick={onAdd}
              disabled={added}
              className="mt-2 text-xs px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors cursor-pointer"
            >
              {added ? t('✓ Added') : t('+ Watchlist')}
            </button>
          )}
        </div>
      </div>
    )
  }

  // ── Full card mode ────────────────────────────────────────────────────────
  return (
    <div className="bg-zinc-800 border border-zinc-700 rounded-xl overflow-hidden hover:border-zinc-600 transition-all group flex flex-col cursor-pointer" onClick={onClick}>
      {/* Poster */}
      <div className="relative bg-zinc-700" style={{ aspectRatio: '2/3' }}>
        {posterUrl ? (
          <img src={posterUrl} alt={title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-zinc-500">
            <span className="text-5xl">🎬</span>
          </div>
        )}
        {rating && (
          <div className="absolute top-2 right-2 bg-black/70 backdrop-blur-sm text-yellow-400 text-xs font-bold px-1.5 py-0.5 rounded-md">
            ★ {rating}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3 flex flex-col flex-1">
        <p className="text-sm font-semibold text-white line-clamp-1 leading-tight">{title}</p>
        <p className="text-xs text-zinc-400 mt-0.5">{year}</p>

        {movie.genres && movie.genres.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {movie.genres.slice(0, 2).map(g => (
              <span key={g} className="text-xs px-1.5 py-0.5 bg-zinc-700 text-zinc-300 rounded-md">{genreLabel(g, lang)}</span>
            ))}
          </div>
        )}

        <p className="text-xs text-zinc-400 mt-2 line-clamp-3 leading-relaxed flex-1">{overview}</p>

        {/* Action buttons */}
        <div className="flex gap-1.5 mt-3">
          {onMarkWatched && (
            <button
              onClick={e => { e.stopPropagation(); onMarkWatched() }}
              className="flex-1 text-xs py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-medium transition-colors cursor-pointer"
            >
              {t('✓ Watched')}
            </button>
          )}
          {onAdd && (
            <button
              onClick={e => { e.stopPropagation(); onAdd() }}
              disabled={added}
              className="flex-1 text-xs py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-400 disabled:cursor-not-allowed text-white font-medium transition-colors cursor-pointer"
            >
              {added ? t('✓ Added') : t('+ Add')}
            </button>
          )}
          {showRemove && onRemove && (
            <button
              onClick={e => { e.stopPropagation(); onRemove() }}
              className="text-xs px-2 py-1.5 rounded-lg bg-zinc-700 hover:bg-red-900/70 text-zinc-400 hover:text-red-300 transition-colors cursor-pointer"
              title={t('Remove from list')}
            >
              ✕
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
