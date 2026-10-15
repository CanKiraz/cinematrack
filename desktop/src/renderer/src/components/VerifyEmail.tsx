import { useState } from 'react'
import { User } from 'firebase/auth'
import { isLegacyAccount, logout, refreshUser, resendVerification, upgradeLegacyEmail } from '../services/auth'
import { useI18n } from '../services/i18n'

interface Props {
  user: User
  /** called after the account's e-mail has been verified */
  onVerified: (user: User) => void
}

const inputClass = 'w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500 transition-colors'
const primaryBtn = 'w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold text-white transition-colors cursor-pointer'

/** Shown to a signed-in user whose e-mail is not verified yet (new accounts), or who still has a pre-launch fake address. */
export default function VerifyEmail({ user, onVerified }: Props) {
  const { t } = useI18n()
  const legacy = isLegacyAccount(user)
  const [newEmail, setNewEmail] = useState('')
  const [sentTo, setSentTo]     = useState<string | null>(null)
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [info, setInfo]         = useState<string | null>(null)

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null); setInfo(null)
    try { await fn() }
    catch (e) {
      const code = (e as { code?: string }).code
      console.error('account step failed:', e)
      if (code === 'auth/email-already-in-use') setError(t('That email is already registered.'))
      else if (code === 'auth/invalid-email') setError(t('Enter a valid email address.'))
      else if (code === 'auth/too-many-requests') setError(t('Too many attempts. Try again later.'))
      else if (code === 'auth/requires-recent-login') setError(t('For security, sign out, sign in again, then try this once more.'))
      else setError(t('Something went wrong. Try again.') + (code ? ` (${code})` : ''))
    } finally { setBusy(false) }
  }

  const checkVerified = () => run(async () => {
    const fresh = await refreshUser()
    if (fresh?.emailVerified) onVerified(fresh)
    else setError(t('Not verified yet. Check your inbox (and spam folder).'))
  })

  const resend = () => run(async () => {
    await resendVerification()
    setInfo(t('Email sent.'))
  })

  const sendUpgrade = () => run(async () => {
    await upgradeLegacyEmail(newEmail)
    setSentTo(newEmail.trim())
  })

  return (
    <div className="min-h-full flex items-center justify-center py-12">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-sm mx-6 p-6 shadow-2xl">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-2xl">✉️</span>
          <h2 className="text-base font-bold text-white">{legacy ? t('Upgrade your account') : t('Verify your email')}</h2>
        </div>

        {error && <div className="mb-4 px-3 py-2 bg-red-900/30 border border-red-800 rounded-lg text-xs text-red-300">{error}</div>}
        {info && <div className="mb-4 px-3 py-2 bg-emerald-900/30 border border-emerald-800 rounded-lg text-xs text-emerald-300">{info}</div>}

        {legacy ? (
          sentTo ? (
            <div className="space-y-4">
              <p className="text-sm text-zinc-300">{t('We sent a confirmation link to {0}.', sentTo)}</p>
              <p className="text-xs text-zinc-400">{t('Open it (check the spam folder too), then sign in again with that email. Your lists stay exactly as they are. If nothing arrives, an account with this email may already exist: sign out and sign in with it.')}</p>
              <button onClick={logout} className={primaryBtn}>{t('Sign out')}</button>
              <button onClick={() => setSentTo(null)} className="w-full text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer">
                {t('Did not arrive? Try an email address again')}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-xs text-zinc-400 leading-relaxed">
                {t('CinemaTrack now uses real email addresses, so you can reset a forgotten password. Enter yours and we will send a confirmation link. Your lists stay exactly as they are.')}
              </p>
              <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && newEmail.trim() && sendUpgrade()}
                placeholder="you@example.com" className={inputClass} />
              <button onClick={sendUpgrade} disabled={busy || !newEmail.trim()} className={primaryBtn}>
                {busy ? '…' : t('Send confirmation link')}
              </button>
              <button onClick={logout} className="w-full text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer">{t('Sign out')}</button>
            </div>
          )
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-zinc-300">{t('We sent a verification link to {0}.', user.email ?? '')}</p>
            <p className="text-xs text-zinc-400">{t('Open it, then come back and press the button below.')}</p>
            <button onClick={checkVerified} disabled={busy} className={primaryBtn}>{busy ? '…' : t("I've verified")}</button>
            <div className="flex justify-between">
              <button onClick={resend} disabled={busy} className="text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer">{t('Resend email')}</button>
              <button onClick={logout} className="text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer">{t('Sign out')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
