import { currentUser, logout } from '../services/auth'
import { useI18n } from '../services/i18n'

interface Props {
  onClose: () => void
}

/** Account and about. (There are no API keys to enter: search and AI go through the CinemaTrack API.) */
export default function SettingsModal({ onClose }: Props) {
  const { t } = useI18n()
  const user = currentUser()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-md mx-4 p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-white mb-5">{t('Settings')}</h2>

        <div className="mb-6">
          <p className="block text-xs font-semibold text-zinc-300 mb-2 uppercase tracking-wide">{t('Account')}</p>
          <div className="bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3">
            <p className="text-sm text-white">{user?.displayName || '—'}</p>
            <p className="text-xs text-zinc-400 mt-0.5">{user?.email}</p>
          </div>
          <button
            onClick={() => { onClose(); void logout() }}
            className="mt-3 text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer"
          >
            {t('Sign out')}
          </button>
        </div>

        <div className="mb-6">
          <p className="block text-xs font-semibold text-zinc-300 mb-2 uppercase tracking-wide">{t('About')}</p>
          <p className="text-xs text-zinc-400 leading-relaxed">
            {t('CinemaTrack is open source (MIT). Movie and series data comes from TMDB; AI answers come from Google Gemini.')}
          </p>
          <p className="text-xs text-zinc-500 leading-relaxed mt-2">
            This product uses the TMDB API but is not endorsed or certified by TMDB.
          </p>
        </div>

        <button
          onClick={onClose}
          className="w-full py-2.5 rounded-xl border border-zinc-700 text-sm text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer"
        >
          {t('Close')}
        </button>
      </div>
    </div>
  )
}
