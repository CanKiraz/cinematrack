import { Page, Kind } from '../types'
import { useI18n } from '../services/i18n'

interface Props {
  page: Page
  setPage: (page: Page) => void
  kind: Kind
  setKind: (kind: Kind) => void
  onSettings: () => void
}

export default function Sidebar({ page, setPage, kind, setKind, onSettings }: Props) {
  const { t, lang, toggleLang } = useI18n()

  const navItems: { id: Page; label: string; emoji: string }[] = [
    { id: 'watchlist', label: kind === 'tv' ? t('Series List') : t('Watchlist'), emoji: kind === 'tv' ? '📺' : '🎬' },
    { id: 'stats',     label: t('Statistics'),     emoji: '📊' },
    { id: 'ai',        label: t('AI Chat'),        emoji: '✨' },
    { id: 'together',  label: t('Watch Together'), emoji: '🤝' }
  ]

  const brands: { id: Kind; label: string; emoji: string }[] = [
    { id: 'movie', label: 'CinemaTrack', emoji: '🎥' },
    { id: 'tv',    label: 'DiziTrack',   emoji: '📺' }
  ]

  return (
    <aside className="w-52 bg-zinc-900 border-r border-zinc-800 flex flex-col shrink-0 pt-8">
      {/* CinemaTrack (movies) <-> DiziTrack (series) */}
      <div className="px-3 mb-7 space-y-1">
        {brands.map(b => (
          <button
            key={b.id}
            onClick={() => setKind(b.id)}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-semibold tracking-tight transition-colors text-left cursor-pointer ${
              kind === b.id
                ? 'bg-blue-600 text-white'
                : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200'
            }`}
          >
            <span className="text-lg leading-none">{b.emoji}</span>
            {b.label}
          </button>
        ))}
      </div>

      {/* Nav links */}
      <nav className="flex-1 px-2 space-y-0.5">
        {navItems.map(item => (
          <button
            key={item.id}
            onClick={() => setPage(item.id)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left cursor-pointer ${
              page === item.id
                ? 'bg-blue-600 text-white'
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
            }`}
          >
            <span className="text-base leading-none">{item.emoji}</span>
            {item.label}
          </button>
        ))}
      </nav>

      {/* Language + settings at the bottom */}
      <div className="px-2 pb-5 space-y-0.5">
        <button
          onClick={toggleLang}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors cursor-pointer"
          title={t('Change language')}
        >
          <span className="text-base leading-none">🌐</span>
          {lang === 'tr' ? 'English' : 'Türkçe'}
        </button>
        <button
          onClick={onSettings}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors cursor-pointer"
        >
          <span className="text-base leading-none">⚙️</span>
          {t('Settings')}
        </button>
      </div>
    </aside>
  )
}
