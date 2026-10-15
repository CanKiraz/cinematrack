import { useState, useEffect } from 'react'
import { Kind, Movie } from '../types'
import { useI18n, titleOf, overviewOf, genreLabel } from '../services/i18n'

interface Props {
  movie: Movie
  kind?: Kind
  onClose: () => void
  onAdd?: () => void
  onRemove?: () => void
  onMarkWatched?: () => void
  onLogWatched?: () => void
  inWatchlist?: boolean
}

interface Provider {
  provider_id: number
  provider_name: string
  logo_path: string
}

interface StreamingData {
  flatrate?: Provider[]  // subscription (Netflix, Prime etc)
  rent?: Provider[]
  buy?: Provider[]
  free?: Provider[]
}

// Known platform display names and colors
const PLATFORM_STYLE: Record<string, { color: string; short: string }> = {
  'Netflix':                { color: '#e50914', short: 'Netflix' },
  'Amazon Prime Video':     { color: '#00a8e0', short: 'Prime' },
  'Disney Plus':            { color: '#113ccf', short: 'Disney+' },
  'Max':                    { color: '#002be7', short: 'Max' },
  'HBO Max':                { color: '#002be7', short: 'Max' },
  'Google Play Movies':     { color: '#4285f4', short: 'Google TV' },
  'Apple TV Plus':          { color: '#555555', short: 'Apple TV+' },
  'Mubi':                   { color: '#000000', short: 'Mubi' },
  'YouTube Premium':        { color: '#ff0000', short: 'YouTube' },
  'Gain':                   { color: '#1a1a2e', short: 'Gain' },
  'Blu TV':                 { color: '#ff6b00', short: 'BluTV' },
  'MUBI':                   { color: '#000000', short: 'Mubi' },
  'Puhutv':                 { color: '#f97316', short: 'Puhutv' },
}

function ProviderBadge({ provider }: { provider: Provider }) {
  const style = PLATFORM_STYLE[provider.provider_name]
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-700 border border-zinc-600">
      {provider.logo_path && (
        <img
          src={`https://image.tmdb.org/t/p/w45${provider.logo_path}`}
          alt={provider.provider_name}
          className="w-5 h-5 rounded"
        />
      )}
      <span className="text-xs text-white font-medium">
        {style?.short || provider.provider_name}
      </span>
    </div>
  )
}

export default function MovieDetailModal({ movie, kind = 'movie', onClose, onAdd, onRemove, onMarkWatched, onLogWatched, inWatchlist }: Props) {
  const { t, lang } = useI18n()
  const [streaming, setStreaming] = useState<StreamingData | null>(null)
  const [streamingLoaded, setStreamingLoaded] = useState(false)

  const posterUrl = movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null
  const year    = movie.release_date ? movie.release_date.substring(0, 4) : '—'
  const rating  = movie.vote_average ? Number(movie.vote_average).toFixed(1) : null
  const runtimeText = movie.runtime ? `${Math.floor(movie.runtime / 60)}h ${movie.runtime % 60}m` : null
  const runtime = runtimeText && kind === 'tv' ? t('{0} per episode', runtimeText) : runtimeText
  const title = titleOf(movie, lang)
  const overview = overviewOf(movie, lang)

  useEffect(() => {
    if (!movie.tmdb_id) return
    window.api.getWatchProviders(movie.tmdb_id, kind)
      .then(tr => {
        setStreaming((tr as StreamingData | null) || null)
        setStreamingLoaded(true)
      })
      .catch(() => setStreamingLoaded(true))
  }, [movie.tmdb_id, kind])

  const hasStreaming = streaming && (
    (streaming.flatrate && streaming.flatrate.length > 0) ||
    (streaming.rent && streaming.rent.length > 0) ||
    (streaming.buy && streaming.buy.length > 0) ||
    (streaming.free && streaming.free.length > 0)
  )

  const groups: { key: keyof StreamingData; label: string }[] = [
    { key: 'flatrate', label: t('Stream') },
    { key: 'free',     label: t('Free') },
    { key: 'rent',     label: t('Rent') },
    { key: 'buy',      label: t('Buy') }
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="flex gap-6 p-6">
          {/* Poster */}
          {posterUrl
            ? <img src={posterUrl} alt={title} className="w-44 rounded-xl object-cover shrink-0 shadow-lg" style={{ aspectRatio: '2/3' }} />
            : <div className="w-44 rounded-xl bg-zinc-700 shrink-0 flex items-center justify-center text-5xl shadow-lg" style={{ aspectRatio: '2/3' }}>🎬</div>
          }

          <div className="flex-1 min-w-0 flex flex-col">
            <h2 className="text-xl font-bold text-white leading-snug">{title}</h2>

            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm text-zinc-400">
              <span>{year}</span>
              {runtime && <span>⏱ {runtime}</span>}
              {rating && <span className="text-yellow-400 font-semibold">★ {rating} / 10</span>}
            </div>

            {movie.genres && movie.genres.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {movie.genres.map(g => (
                  <span key={g} className="text-xs px-2 py-0.5 bg-zinc-700 text-zinc-300 rounded-md">{genreLabel(g, lang)}</span>
                ))}
              </div>
            )}

            {/* Overview */}
            <div className="mt-4">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">{t('Overview')}</p>
              <p className="text-sm text-zinc-300 leading-relaxed">{overview || t('No description available.')}</p>
            </div>

            {/* Streaming availability — Turkey */}
            <div className="mt-4">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                {t('🇹🇷 Available in Turkey')}
              </p>
              {!streamingLoaded ? (
                <p className="text-xs text-zinc-500">{t('Checking platforms…')}</p>
              ) : !hasStreaming ? (
                <p className="text-xs text-zinc-500">{t('Not available on streaming platforms in Turkey')}</p>
              ) : (
                <div className="space-y-2">
                  {groups.map(g => {
                    const list = streaming?.[g.key]
                    if (!list || list.length === 0) return null
                    return (
                      <div key={g.key}>
                        <p className="text-xs text-zinc-500 mb-1">{g.label}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {list.map(p => <ProviderBadge key={p.provider_id} provider={p} />)}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2 mt-5">
              {onMarkWatched && (
                <button onClick={() => { onClose(); onMarkWatched() }}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-sm font-semibold text-white transition-colors cursor-pointer">
                  {t('✓ Mark Watched')}
                </button>
              )}
              {onLogWatched && (
                <button onClick={() => { onClose(); onLogWatched() }}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-sm font-semibold text-white transition-colors cursor-pointer">
                  {t('✓ Log as Watched')}
                </button>
              )}
              {onAdd && !inWatchlist && (
                <button onClick={() => { onAdd(); onClose() }}
                  className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm font-semibold text-white transition-colors cursor-pointer">
                  {t('+ Add to List')}
                </button>
              )}
              {inWatchlist && !onMarkWatched && (
                <div className="flex-1 py-2.5 rounded-xl bg-zinc-700 text-sm font-semibold text-zinc-400 text-center">{t('✓ In your list')}</div>
              )}
              {onRemove && (
                <button onClick={() => { onRemove(); onClose() }}
                  className="px-4 py-2.5 rounded-xl bg-zinc-700 hover:bg-red-900/70 text-zinc-400 hover:text-red-300 text-sm transition-colors cursor-pointer">
                  {t('Remove')}
                </button>
              )}
              <button onClick={onClose}
                className="px-4 py-2.5 rounded-xl border border-zinc-700 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer">
                {t('Close')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
