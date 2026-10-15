import { useState } from 'react'
import { currentUser, logout } from '../services/auth'
import { deleteMyAccount } from '../services/account'
import { useI18n } from '../services/i18n'

interface Props {
  onClose: () => void
  /** Called right before the online data is deleted, so the app stops mirroring the removals into the local database. */
  onBeforeDelete: () => void
}

/** Account and about. (There are no API keys to enter: search and AI go through the CinemaTrack API.) */
export default function SettingsModal({ onClose, onBeforeDelete }: Props) {
  const { t } = useI18n()
  const user = currentUser()
  const [deleting, setDeleting]   = useState(false)   // the confirmation step is open
  const [password, setPassword]   = useState('')
  const [busy, setBusy]           = useState(false)
  const [error, setError]         = useState<string | null>(null)

  async function confirmDelete() {
    if (!password || busy) return
    setBusy(true); setError(null)
    try {
      onBeforeDelete()
      await deleteMyAccount(password)
      // the account is gone: the sign-in screen takes over by itself
    } catch (e) {
      const code = (e as { code?: string }).code
      console.error('account deletion failed:', e)
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') setError(t('Wrong password.'))
      else if (code === 'auth/too-many-requests') setError(t('Too many attempts. Try again later.'))
      else setError(t('Could not delete the account. Nothing was lost; try again.') + (code ? ` (${code})` : ''))
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75" onClick={busy ? undefined : onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-md mx-4 p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-white mb-5">{t('Settings')}</h2>

        <div className="mb-6">
          <p className="block text-xs font-semibold text-zinc-300 mb-2 uppercase tracking-wide">{t('Account')}</p>
          <div className="bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3">
            <p className="text-sm text-white">{user?.displayName || '—'}</p>
            <p className="text-xs text-zinc-400 mt-0.5">{user?.email}</p>
          </div>
          <div className="mt-3 flex items-center gap-4">
            <button
              onClick={() => { onClose(); void logout() }}
              className="text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer"
            >
              {t('Sign out')}
            </button>
            {!deleting && (
              <button onClick={() => setDeleting(true)} className="text-xs text-red-400 hover:text-red-300 cursor-pointer">
                {t('Delete account…')}
              </button>
            )}
          </div>

          {deleting && (
            <div className="mt-4 p-4 bg-red-950/30 border border-red-900 rounded-xl">
              <p className="text-sm font-semibold text-red-300 mb-1">{t('Delete your account?')}</p>
              <p className="text-xs text-zinc-300 leading-relaxed mb-3">
                {t('This permanently deletes your account and everything stored online: your lists, ratings, notes and Watch Together sessions. It cannot be undone. Data saved on this computer stays until you uninstall the app.')}
              </p>
              {error && <p className="text-xs text-red-300 mb-2">{error}</p>}
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && confirmDelete()}
                placeholder={t('Type your password to confirm')}
                disabled={busy}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-red-500 mb-3"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => { setDeleting(false); setPassword(''); setError(null) }}
                  disabled={busy}
                  className="flex-1 py-2 rounded-lg border border-zinc-700 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 cursor-pointer"
                >
                  {t('Cancel')}
                </button>
                <button
                  onClick={confirmDelete}
                  disabled={busy || !password}
                  className="flex-1 py-2 rounded-lg bg-red-700 hover:bg-red-600 disabled:opacity-40 text-xs font-semibold text-white cursor-pointer"
                >
                  {busy ? '…' : t('Delete my account')}
                </button>
              </div>
            </div>
          )}
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
          disabled={busy}
          className="w-full py-2.5 rounded-xl border border-zinc-700 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 transition-colors cursor-pointer"
        >
          {t('Close')}
        </button>
      </div>
    </div>
  )
}
