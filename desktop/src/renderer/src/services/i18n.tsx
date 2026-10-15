import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react'
import { Movie } from '../types'
import { TR } from './i18n-tr'

// The UI text is written in English in the code: t('Add to Watchlist').
// In Turkish mode it is looked up in the dictionary (i18n-tr.ts); anything missing simply stays English.
// Placeholders: t('Session with {0}', name).

export type Lang = 'en' | 'tr'
const STORAGE_KEY = 'cinematrack:lang'

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'tr' || saved === 'en') return saved
  } catch { /* ignore */ }
  return navigator.language?.toLowerCase().startsWith('tr') ? 'tr' : 'en'
}

interface I18n {
  lang: Lang
  setLang: (l: Lang) => void
  toggleLang: () => void
  t: (en: string, ...args: (string | number)[]) => string
  /** value for TMDB's `language` parameter */
  tmdbLang: 'tr-TR' | 'en-US'
}

const Ctx = createContext<I18n | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang)

  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    try { localStorage.setItem(STORAGE_KEY, l) } catch { /* ignore */ }
  }, [])

  useEffect(() => { document.documentElement.lang = lang }, [lang])

  const t = useCallback((en: string, ...args: (string | number)[]) => {
    let s = lang === 'tr' ? (TR[en] ?? en) : en
    args.forEach((a, i) => { s = s.split(`{${i}}`).join(String(a)) })
    return s
  }, [lang])

  const value: I18n = {
    lang, setLang,
    toggleLang: () => setLang(lang === 'tr' ? 'en' : 'tr'),
    t,
    tmdbLang: lang === 'tr' ? 'tr-TR' : 'en-US'
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useI18n(): I18n {
  const v = useContext(Ctx)
  if (!v) throw new Error('useI18n must be used inside <I18nProvider>')
  return v
}

// ── Titles, overviews and genres in the chosen language ───────────────────────

export function titleOf(m: { title: string; title_tr?: string | null }, lang: Lang): string {
  return lang === 'tr' && m.title_tr && m.title_tr.trim() ? m.title_tr : m.title
}

export function overviewOf(m: { overview: string; overview_tr?: string | null }, lang: Lang): string {
  return lang === 'tr' && m.overview_tr && m.overview_tr.trim() ? m.overview_tr : m.overview
}

const GENRES_TR: Record<string, string> = {
  'Action': 'Aksiyon', 'Adventure': 'Macera', 'Animation': 'Animasyon', 'Comedy': 'Komedi', 'Crime': 'Suç',
  'Documentary': 'Belgesel', 'Drama': 'Dram', 'Family': 'Aile', 'Fantasy': 'Fantastik', 'History': 'Tarih',
  'Horror': 'Korku', 'Music': 'Müzik', 'Mystery': 'Gizem', 'Romance': 'Romantik', 'Science Fiction': 'Bilim Kurgu',
  'TV Movie': 'TV Filmi', 'Thriller': 'Gerilim', 'War': 'Savaş', 'Western': 'Vahşi Batı',
  'Action & Adventure': 'Aksiyon ve Macera', 'Kids': 'Çocuk', 'News': 'Haber', 'Reality': 'Gerçeklik',
  'Sci-Fi & Fantasy': 'Bilim Kurgu ve Fantastik', 'Soap': 'Pembe Dizi', 'Talk': 'Sohbet', 'War & Politics': 'Savaş ve Politika'
}

/** Genres are stored in English; this is only for showing them. */
export function genreLabel(genre: string, lang: Lang): string {
  return lang === 'tr' ? (GENRES_TR[genre] ?? genre) : genre
}

export type MovieLike = Pick<Movie, 'title' | 'overview'> & { title_tr?: string | null; overview_tr?: string | null }
