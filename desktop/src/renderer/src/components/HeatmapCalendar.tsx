import { useState, useMemo } from 'react'
import { HeatmapDay, Kind } from '../types'
import { useI18n, Lang } from '../services/i18n'

interface Props { data: HeatmapDay[]; kind?: Kind }
type HeatmapView = 'daily' | 'weekly' | 'monthly' | 'yearly'
interface Cell { key: string; label: string; titles: string[]; posters: (string | null)[] }

// Local calendar date as YYYY-MM-DD (toISOString is UTC, which shifts the day around midnight)
function dateKey(d: Date): string {
  return d.toLocaleDateString('sv-SE')
}

export default function HeatmapCalendar({ data, kind = 'movie' }: Props) {
  const { t, lang } = useI18n()
  const [view, setView] = useState<HeatmapView>('daily')
  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string; titles: string[] } | null>(null)

  const dateMap = useMemo(() => {
    const map = new Map<string, { titles: string[]; posters: (string | null)[] }>()
    for (const d of data) {
      const titles = d.titles.map((title, i) => (lang === 'tr' && d.titles_tr?.[i]?.trim()) ? d.titles_tr[i] as string : title)
      map.set(d.date.substring(0, 10), { titles, posters: d.posters || [] })
    }
    return map
  }, [data, lang])

  const cells = useMemo(() => buildCells(view, dateMap, lang), [view, dateMap, lang])
  const icon = kind === 'tv' ? '📺' : '🎬'

  function onEnter(e: React.MouseEvent<HTMLDivElement>, cell: Cell) {
    if (!cell.titles.length) return
    const rect = e.currentTarget.getBoundingClientRect()
    setTooltip({ x: rect.left + rect.width / 2, y: rect.top, label: cell.label, titles: cell.titles })
  }

  const views: { id: HeatmapView; label: string }[] = [
    { id: 'daily',   label: t('Daily') },
    { id: 'weekly',  label: t('Weekly') },
    { id: 'monthly', label: t('Monthly') },
    { id: 'yearly',  label: t('Yearly') }
  ]

  return (
    <div className="relative">
      <div className="flex gap-1.5 mb-3">
        {views.map(v => (
          <button key={v.id} onClick={() => setView(v.id)}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
              view === v.id ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
            }`}>
            {v.label}
          </button>
        ))}
      </div>

      <div className="bg-zinc-800/60 border border-zinc-700 rounded-xl p-4">
        {view === 'daily' ? (
          /* Daily: full card with centered title and list */
          <div className={`rounded-xl border transition-colors ${cells[0]?.titles.length ? 'bg-blue-600/15 border-blue-600/40' : 'bg-zinc-700/30 border-zinc-600/40'}`}>
            {/* Centered date header */}
            <div className="flex items-center justify-center gap-2 py-3 border-b border-inherit">
              <div className={`w-3 h-3 rounded-sm shrink-0 ${cells[0]?.titles.length ? 'bg-blue-500' : 'bg-zinc-600'}`} />
              <p className="text-sm font-semibold text-zinc-200">{t('Today')} — {cells[0]?.label}</p>
            </div>

            {/* List or empty state */}
            {cells[0]?.titles.length ? (
              <div className="py-2 px-3 space-y-2">
                {cells[0].titles.map((title, i) => {
                  const poster = cells[0].posters[i]
                  const posterUrl = poster ? `https://image.tmdb.org/t/p/w92${poster}` : null
                  return (
                    <div key={i} className="flex items-center gap-2.5">
                      {posterUrl
                        ? <img src={posterUrl} alt={title} className="w-7 h-10 rounded object-cover shrink-0 border border-blue-700/50" />
                        : <div className="w-7 h-10 rounded bg-blue-900/60 border border-blue-700/50 flex items-center justify-center text-sm shrink-0">{icon}</div>
                      }
                      <p className="text-sm text-zinc-200 font-medium truncate">{title}</p>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-xs text-zinc-500 text-center py-4">{kind === 'tv' ? t('No series watched today') : t('No movies watched today')}</p>
            )}
          </div>
        ) : (
          <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${gridCols(view)}, minmax(0, 1fr))` }}>
            {cells.map(cell => (
              <div key={cell.key}
                className={`rounded-sm transition-colors cursor-default aspect-square ${
                  cell.titles.length ? 'bg-blue-500 hover:bg-blue-400' : 'bg-zinc-700/80 hover:bg-zinc-600'
                }`}
                onMouseEnter={e => onEnter(e, cell)}
                onMouseLeave={() => setTooltip(null)}
              />
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 mt-3 justify-end">
          <span className="text-xs text-zinc-500">{kind === 'tv' ? t('No series') : t('No movies')}</span>
          <div className="w-3 h-3 rounded-sm bg-zinc-700" />
          <div className="w-3 h-3 rounded-sm bg-blue-500" />
          <span className="text-xs text-zinc-500">{t('Watched')}</span>
        </div>
      </div>

      {tooltip && (
        <div className="fixed z-50 pointer-events-none bg-zinc-900 border border-zinc-700 text-xs text-zinc-100 px-3 py-2 rounded-lg shadow-xl max-w-[240px]"
          style={{ left: tooltip.x, top: tooltip.y - 8, transform: 'translate(-50%, -100%)' }}>
          <p className="font-medium text-zinc-300 mb-1">{tooltip.label}</p>
          {tooltip.titles.map((title, i) => <p key={i} className="text-zinc-400 truncate">{icon} {title}</p>)}
        </div>
      )}
    </div>
  )
}

function buildCells(view: HeatmapView, dateMap: Map<string, { titles: string[]; posters: (string | null)[] }>, lang: Lang): Cell[] {
  const now = new Date()
  const cells: Cell[] = []
  const days = view === 'daily' ? 1 : view === 'weekly' ? 7 : view === 'monthly' ? 30 : 365
  const locale = lang === 'tr' ? 'tr-TR' : 'en-GB'
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const key = dateKey(d)
    const entry = dateMap.get(key)
    cells.push({
      key,
      label: view === 'daily' ? d.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }) : d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }),
      titles: entry?.titles || [],
      posters: entry?.posters || []
    })
  }
  return cells
}

function gridCols(view: HeatmapView): number {
  return { daily: 1, weekly: 7, monthly: 10, yearly: 26 }[view]
}
