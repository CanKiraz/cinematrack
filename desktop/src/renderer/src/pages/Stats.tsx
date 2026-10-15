import { useState, useEffect } from 'react'
import HeatmapCalendar from '../components/HeatmapCalendar'
import { Kind, Stats as StatsData, WatchLogEntry, HeatmapDay } from '../types'
import { syncUid } from '../services/auth'
import { syncRemoveWatchLog } from '../services/sync'
import { onDataChanged } from '../services/events'
import { useI18n, titleOf, genreLabel } from '../services/i18n'

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-4">
      <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{label}</p>
      <p className="text-3xl font-bold text-white mt-1 leading-none">{value}</p>
      {sub && <p className="text-xs text-zinc-500 mt-1">{sub}</p>}
    </div>
  )
}

export default function Stats({ kind }: { kind: Kind }) {
  const { t, lang } = useI18n()
  const [stats, setStats]     = useState<StatsData | null>(null)
  const [log, setLog]         = useState<WatchLogEntry[]>([])
  const [heatmap, setHeatmap] = useState<HeatmapDay[]>([])
  const isTv = kind === 'tv'

  async function load() {
    const [s, l, h] = await Promise.all([
      window.api.getStats(kind),
      window.api.getWatchLog(kind),
      window.api.getWatchLogByDate(kind)
    ])
    setStats(s); setLog(l); setHeatmap(h)
  }

  useEffect(() => { load() }, [kind])
  useEffect(() => onDataChanged(() => { load() }), [kind])

  async function removeEntry(logId: number, entry: WatchLogEntry) {
    await window.api.removeWatchLog(logId, kind)
    const uid = syncUid()
    if (uid && entry.remote_id) {
      await syncRemoveWatchLog(uid, entry.remote_id, kind).catch(() => {})
    }
    setLog(prev => prev.filter(e => e.log_id !== logId))
    const s = await window.api.getStats(kind)
    setStats(s)
  }

  if (!stats) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-500 text-sm">
        {t('Loading…')}
      </div>
    )
  }

  const avgRating = stats.avg_rating != null ? Number(stats.avg_rating).toFixed(1) : '—'
  const monthName = new Date().toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US', { month: 'long' })

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-6 pt-8 pb-10">
        <h1 className="text-2xl font-bold text-white">{t('Statistics')}</h1>
        <p className="text-sm text-zinc-400 mt-0.5 mb-6">
          {isTv ? t('Your series watching history at a glance') : t('Your movie watching history at a glance')}
        </p>

        {/* Summary cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
          <StatCard label={t('Total Watched')}  value={stats.total_watched}  sub={t('all time')} />
          <StatCard label={t('This Month')}     value={stats.this_month}     sub={monthName} />
          <StatCard label={t('Avg Rating')}     value={avgRating}            sub={t('out of 10')} />
          <StatCard label={t('Top Genre')}      value={stats.favorite_genre ? genreLabel(stats.favorite_genre, lang) : '—'} sub={t('by watch count')} />
        </div>

        {/* Secondary stats row */}
        <div className="grid grid-cols-2 gap-3 mb-8">
          <div className="bg-zinc-800/50 border border-zinc-700 rounded-xl px-4 py-3 flex items-center gap-4">
            <span className="text-2xl">📋</span>
            <div>
              <p className="text-xl font-bold text-white">{stats.watchlist_count}</p>
              <p className="text-xs text-zinc-400">{isTv ? t('series in your list') : t('movies in watchlist')}</p>
            </div>
          </div>
          <div className="bg-zinc-800/50 border border-zinc-700 rounded-xl px-4 py-3 flex items-center gap-4">
            <span className="text-2xl">📅</span>
            <div>
              <p className="text-xl font-bold text-white">{stats.this_week}</p>
              <p className="text-xs text-zinc-400">{t('watched this week')}</p>
            </div>
          </div>
        </div>

        {/* Heatmap */}
        <div className="mb-8">
          <h2 className="text-base font-semibold text-white mb-3">{t('Watching Activity')}</h2>
          <HeatmapCalendar data={heatmap} kind={kind} />
        </div>

        {/* Watch history */}
        <div>
          <h2 className="text-base font-semibold text-white mb-3">{t('Watch History')}</h2>
          {log.length > 0 ? (
            <div className="space-y-2">
              {log.map(entry => {
                const posterUrl = entry.poster_path
                  ? `https://image.tmdb.org/t/p/w92${entry.poster_path}`
                  : null
                const dateStr = new Date(entry.watched_at + 'T12:00:00').toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-US', {
                  year: 'numeric', month: 'short', day: 'numeric'
                })
                const title = titleOf(entry, lang)

                return (
                  <div key={entry.log_id} className="flex items-center gap-4 p-3 bg-zinc-800 border border-zinc-700 rounded-xl group">
                    {posterUrl ? (
                      <img src={posterUrl} alt={title} className="w-10 h-14 object-cover rounded-lg shrink-0" />
                    ) : (
                      <div className="w-10 h-14 bg-zinc-700 rounded-lg shrink-0 flex items-center justify-center text-zinc-500">🎬</div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{title}</p>
                      <p className="text-xs text-zinc-400 mt-0.5">{dateStr}</p>
                      {entry.notes && (
                        <p className="text-xs text-zinc-500 mt-1 line-clamp-1 italic">"{entry.notes}"</p>
                      )}
                    </div>
                    {entry.rating != null && (
                      <div className="text-sm font-bold text-yellow-400 shrink-0">★ {entry.rating}</div>
                    )}
                    <button
                      onClick={() => removeEntry(entry.log_id, entry)}
                      title={t('Remove from history')}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-zinc-600 hover:text-red-400 text-sm px-1 cursor-pointer shrink-0"
                    >
                      ✕
                    </button>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-14 gap-3 text-zinc-500">
              <span className="text-5xl">📽️</span>
              <p className="text-sm text-center max-w-xs">
                {isTv
                  ? t('No series watched yet. Head to your series list and mark one as watched!')
                  : t('No movies watched yet. Head to the Watchlist and mark one as watched!')}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
