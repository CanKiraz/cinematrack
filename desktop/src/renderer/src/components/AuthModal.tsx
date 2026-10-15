import { useState } from 'react'
import { register, login, resetPassword, MIN_PASSWORD, DISPLAY_NAME_RE } from '../services/auth'
import { useI18n } from '../services/i18n'

interface Props {
  onSuccess: () => void
}

type Mode = 'login' | 'register' | 'reset'

const inputClass = 'w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500 transition-colors'

export default function AuthModal({ onSuccess }: Props) {
  const { t } = useI18n()
  const [mode, setMode]               = useState<Mode>('login')
  const [email, setEmail]             = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword]       = useState('')
  const [error, setError]             = useState<string | null>(null)
  const [info, setInfo]               = useState<string | null>(null)
  const [loading, setLoading]         = useState(false)

  function switchMode(m: Mode) { setMode(m); setError(null); setInfo(null) }

  function describe(e: unknown): string {
    switch ((e as { code?: string }).code) {
      case 'auth/user-not-found':
      case 'auth/wrong-password':
      case 'auth/invalid-credential':   return t('Wrong email or password.')
      case 'auth/email-already-in-use': return t('That email is already registered.')
      case 'auth/invalid-email':        return t('Enter a valid email address.')
      case 'auth/weak-password':        return t('Password must be at least {0} characters.', MIN_PASSWORD)
      case 'auth/too-many-requests':    return t('Too many attempts. Try again later.')
      case 'auth/network-request-failed': return t('Network error. Check your connection.')
      default:                          return t('Something went wrong. Try again.')
    }
  }

  const canSubmit =
    mode === 'reset' ? email.trim().length > 0
    : mode === 'login' ? email.trim().length > 0 && password.length > 0
    : email.trim().length > 0 && password.length > 0 && displayName.trim().length > 0

  async function handleSubmit() {
    if (!canSubmit || loading) return
    setError(null); setInfo(null)

    if (mode === 'register') {
      if (!DISPLAY_NAME_RE.test(displayName.trim())) { setError(t('Display name: 2–20 letters, numbers, . _ - only.')); return }
      if (password.length < MIN_PASSWORD) { setError(t('Password must be at least {0} characters.', MIN_PASSWORD)); return }
    }

    setLoading(true)
    try {
      if (mode === 'register') {
        await register(email, password, displayName)
        onSuccess()
      } else if (mode === 'login') {
        await login(email, password)
        onSuccess()
      } else {
        await resetPassword(email)
        // Same message whether or not the address exists, so this cannot be used to probe for accounts
        setInfo(t('If an account exists for {0}, we sent a reset link.', email.trim()))
      }
    } catch (e) {
      // For a reset request, do not reveal whether the account exists
      if (mode === 'reset' && (e as { code?: string }).code === 'auth/user-not-found') {
        setInfo(t('If an account exists for {0}, we sent a reset link.', email.trim()))
      } else {
        setError(describe(e))
      }
    } finally {
      setLoading(false)
    }
  }

  const title = mode === 'login' ? t('Sign in to sync with your partner')
    : mode === 'register' ? t('Create your account')
    : t('Reset your password')

  return (
    <div className="min-h-full flex items-center justify-center py-12">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-sm mx-6 p-6 shadow-2xl">
        <div className="flex items-center gap-2 mb-5">
          <span className="text-2xl">🤝</span>
          <div>
            <h2 className="text-base font-bold text-white">{t('Watch Together')}</h2>
            <p className="text-xs text-zinc-400">{title}</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 px-3 py-2 bg-red-900/30 border border-red-800 rounded-lg text-xs text-red-300">{error}</div>
        )}
        {info && (
          <div className="mb-4 px-3 py-2 bg-emerald-900/30 border border-emerald-800 rounded-lg text-xs text-emerald-300">{info}</div>
        )}

        <div className="space-y-3 mb-5">
          <div>
            <label className="text-xs font-medium text-zinc-400 mb-1 block">
              {mode === 'login' ? t('Email (or old username)') : t('Email')}
            </label>
            <input
              type={mode === 'login' ? 'text' : 'email'}
              autoComplete="username"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              placeholder="you@example.com"
              className={inputClass}
            />
          </div>
          {mode === 'register' && (
            <div>
              <label className="text-xs font-medium text-zinc-400 mb-1 block">{t('Display name')}</label>
              <input
                type="text"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                placeholder={t('e.g. alex')}
                className={inputClass}
              />
              <p className="text-xs text-zinc-600 mt-1">{t('Your partner sees this in Watch Together.')}</p>
            </div>
          )}
          {mode !== 'reset' && (
            <div>
              <label className="text-xs font-medium text-zinc-400 mb-1 block">{t('Password')}</label>
              <input
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                placeholder={mode === 'register' ? t('At least {0} characters', MIN_PASSWORD) : ''}
                className={inputClass}
              />
            </div>
          )}
        </div>

        <button
          onClick={handleSubmit}
          disabled={loading || !canSubmit}
          className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold text-white transition-colors cursor-pointer mb-3"
        >
          {loading ? '…' : mode === 'login' ? t('Sign In') : mode === 'register' ? t('Create Account') : t('Send reset link')}
        </button>

        {mode === 'login' && (
          <p className="text-xs text-center mb-2">
            <button onClick={() => switchMode('reset')} className="text-zinc-500 hover:text-zinc-300 cursor-pointer">{t('Forgot password?')}</button>
          </p>
        )}

        <p className="text-xs text-zinc-500 text-center">
          {mode === 'login' ? t("Don't have an account?") + ' ' : mode === 'register' ? t('Already have an account?') + ' ' : ''}
          <button onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
            className="text-blue-400 hover:text-blue-300 cursor-pointer">
            {mode === 'login' ? t('Create one') : mode === 'register' ? t('Sign in') : t('Back to sign in')}
          </button>
        </p>
      </div>
    </div>
  )
}
