import { useState, useEffect } from 'react'
import { useI18n } from '../services/i18n'

interface Props {
  isFirstRun: boolean
  onClose: () => void
}

export default function SettingsModal({ isFirstRun, onClose }: Props) {
  const { t } = useI18n()
  const [tmdbKey, setTmdbKey]     = useState('')
  const [geminiKey, setGeminiKey] = useState('')
  const [saved, setSaved]         = useState(false)

  useEffect(() => {
    async function load() {
      const tk = await window.api.getConfig('tmdb_api_key')
      const gk = await window.api.getConfig('gemini_api_key')
      if (tk) setTmdbKey(tk)
      if (gk) setGeminiKey(gk)
    }
    load()
  }, [])

  async function handleSave() {
    await window.api.setConfig('tmdb_api_key', tmdbKey.trim())
    await window.api.setConfig('gemini_api_key', geminiKey.trim())
    setSaved(true)
    setTimeout(() => { setSaved(false); onClose() }, 900)
  }

  const canSave = tmdbKey.trim().length > 0 && geminiKey.trim().length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-md mx-4 p-6 shadow-2xl">
        <h2 className="text-lg font-semibold text-white mb-1">
          {isFirstRun ? t('👋 Welcome to CinemaTrack') : t('Settings')}
        </h2>
        <p className="text-sm text-zinc-400 mb-6">
          {isFirstRun
            ? t('Enter your free API keys to get started. Both take about 2 minutes to set up.')
            : t('Update your API keys below.')}
        </p>

        <div className="space-y-5">
          {/* TMDB */}
          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1.5 uppercase tracking-wide">
              {t('TMDB API Key')}
            </label>
            <input
              type="password"
              value={tmdbKey}
              onChange={e => setTmdbKey(e.target.value)}
              placeholder={t('Paste your TMDB API key here')}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500 transition-colors"
            />
            <p className="text-xs text-zinc-500 mt-1.5">
              {t('Free at')}{' '}
              <a
                href="https://www.themoviedb.org/settings/api"
                target="_blank"
                rel="noreferrer"
                className="text-blue-400 hover:text-blue-300 underline"
              >
                themoviedb.org
              </a>{' '}
              → Settings → API
            </p>
          </div>

          {/* Gemini */}
          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1.5 uppercase tracking-wide">
              {t('Google Gemini API Key')}
            </label>
            <input
              type="password"
              value={geminiKey}
              onChange={e => setGeminiKey(e.target.value)}
              placeholder={t('Paste your Gemini API key here')}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500 transition-colors"
            />
            <p className="text-xs text-zinc-500 mt-1.5">
              {t('Free at')}{' '}
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-blue-400 hover:text-blue-300 underline"
              >
                aistudio.google.com
              </a>{' '}
              → Create API Key {t('(free tier: 1M tokens/day)')}
            </p>
          </div>
        </div>

        <div className="flex gap-3 mt-7">
          {!isFirstRun && (
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-zinc-700 text-sm text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              {t('Cancel')}
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold text-white transition-colors cursor-pointer"
          >
            {saved ? t('✓ Saved!') : t('Save & Continue')}
          </button>
        </div>
      </div>
    </div>
  )
}
