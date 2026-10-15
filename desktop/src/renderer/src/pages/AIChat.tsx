import { useState, useRef, useEffect } from 'react'
import MovieDetailModal from '../components/MovieDetailModal'
import { ChatMessage, Kind, Movie, WatchlistEntry } from '../types'
import { syncUid } from '../services/auth'
import { syncAddMovie } from '../services/sync'
import { apiErrorText } from '../services/apiError'
import { useI18n, titleOf, overviewOf, genreLabel } from '../services/i18n'

let counter = 0
const uid = () => String(++counter)

function MsgText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return (
    <p className="whitespace-pre-wrap">
      {parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**')
          ? <strong key={i} className="font-semibold text-white">{part.slice(2, -2)}</strong>
          : <span key={i}>{part}</span>
      )}
    </p>
  )
}

interface Props {
  kind: Kind
  messages: ChatMessage[]
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>
}

export default function AIChat({ kind, messages, setMessages }: Props) {
  const { t, lang, tmdbLang } = useI18n()
  const isTv = kind === 'tv'
  const [input, setInput]           = useState('')
  const [loading, setLoading]       = useState(false)
  const [watchlist, setWatchlist]   = useState<WatchlistEntry[]>([])
  const [stats, setStats]           = useState<unknown>(null)
  const [detailMovie, setDetailMovie] = useState<Movie | null>(null)
  const [addedMovies, setAdded]     = useState<Set<number>>(new Set())
  const bottomRef                   = useRef<HTMLDivElement>(null)
  const inputRef                    = useRef<HTMLInputElement>(null)

  const suggestions = isTv ? [
    t('Find a gripping crime series for tonight'),
    t('Pick something from my series list'),
    t('What did I watch recently?'),
    t('Recommend a series like Breaking Bad'),
    t('What are the best comedy series?')
  ] : [
    t('Find a good thriller for tonight'),
    t('Pick something from my watchlist'),
    t('What did I watch recently?'),
    t('Recommend a movie like Interstellar'),
    t('What are the classic 90s movies?')
  ]

  useEffect(() => {
    window.api.getWatchlist(kind).then(data => setWatchlist(data as WatchlistEntry[]))
    window.api.getDetailedStats(kind).then(data => setStats(data))
  }, [kind])

  useEffect(() => {
    if (messages.length === 0) {
      setMessages([{
        id: uid(), role: 'assistant',
        content: isTv
          ? t("Hi! I'm DiziTrack AI. I can help you discover new series, pick something from your list, or talk about what you've watched.\n\nWhat would you like to know?")
          : t("Hi! I'm CinemaTrack AI. I can help you discover new movies, pick something from your watchlist, or talk about your watch history.\n\nWhat would you like to know?")
      }])
    }
  }, [])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const isInWatchlist = (tmdbId: number) => watchlist.some(m => m.tmdb_id === tmdbId)

  function buildHistory(msgs: ChatMessage[]) {
    return msgs.filter(m => !m.loading).slice(0, -1).map(m => ({
      role: m.role === 'user' ? 'user' as const : 'model' as const,
      parts: [{ text: m.content || '…' }]
    }))
  }

  async function send(text: string) {
    if (!text.trim() || loading) return
    setInput('')
    const userMsg:     ChatMessage = { id: uid(), role: 'user', content: text.trim() }
    const thinkingMsg: ChatMessage = { id: uid(), role: 'assistant', content: '', loading: true }
    setMessages(prev => [...prev, userMsg, thinkingMsg])
    setLoading(true)

    try {
      const history = buildHistory(messages)
      const allMessages = [...history, { role: 'user' as const, parts: [{ text: text.trim() }] }]
      const result = await window.api.aiChat(allMessages, watchlist as unknown as Movie[], stats, kind, tmdbLang)
      setMessages(prev => prev.map(m =>
        m.id === thinkingMsg.id
          ? { ...m, content: result.text, suggestedMovies: result.suggestedMovies, loading: false }
          : m
      ))
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('Unknown error')
      const content = apiErrorText(err, t) ?? t('Something went wrong: {0}', msg)
      setMessages(prev => prev.map(m =>
        m.id === thinkingMsg.id ? { ...m, content, loading: false } : m
      ))
    } finally {
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  async function addToWatchlist(movie: Movie) {
    // The suggestion is a bare search result: fetch the full details (genres, Turkish title...) first
    let full = movie
    try { full = await window.api.getMovie(movie.tmdb_id, kind) } catch { /* keep the search result */ }
    await window.api.addToWatchlist(full, kind)
    const userId = syncUid()
    if (userId) await syncAddMovie(userId, full, kind).catch(() => {})
    setAdded(prev => new Set([...prev, movie.tmdb_id]))
    setWatchlist(await window.api.getWatchlist(kind) as WatchlistEntry[])
  }

  return (
    <div className="h-full flex flex-col">
      <div className="border-b border-zinc-800 px-6 pt-8 pb-4 shrink-0">
        <h1 className="text-2xl font-bold text-white">{t('AI Chat')}</h1>
        <p className="text-sm text-zinc-400 mt-0.5">{isTv ? t('Ask Gemini anything about series') : t('Ask Gemini anything about movies')}</p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
        {messages.length <= 1 && (
          <div className="mt-1 mb-2">
            <p className="text-xs text-zinc-500 mb-2">{t('Try one of these:')}</p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map(s => (
                <button key={s} onClick={() => send(s)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white transition-colors cursor-pointer">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={msg.role === 'user' ? 'max-w-[62%]' : 'w-full max-w-[90%]'}>
              <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-sm'
                  : 'bg-zinc-800 border border-zinc-700 text-zinc-100 rounded-bl-sm'
              }`}>
                {msg.loading ? (
                  <span className="flex gap-1.5 items-center py-0.5">
                    <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full dot-1" />
                    <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full dot-2" />
                    <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full dot-3" />
                  </span>
                ) : <MsgText text={msg.content} />}
              </div>

              {msg.suggestedMovies && msg.suggestedMovies.length > 0 && (
                <div className="mt-2 space-y-2">
                  {msg.suggestedMovies.map((movie, i) => (
                    <div key={movie.tmdb_id ?? i}
                      className="flex gap-3 p-3 bg-zinc-800 border border-zinc-700 rounded-xl cursor-pointer hover:border-zinc-600 transition-colors"
                      onClick={() => setDetailMovie(movie)}>
                      {movie.poster_path
                        ? <img src={`https://image.tmdb.org/t/p/w92${movie.poster_path}`} alt={titleOf(movie, lang)} className="w-12 h-[68px] object-cover rounded-lg shrink-0" />
                        : <div className="w-12 h-[68px] bg-zinc-700 rounded-lg shrink-0 flex items-center justify-center text-zinc-500 text-lg">🎬</div>
                      }
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white truncate">{titleOf(movie, lang)}</p>
                        <p className="text-xs text-zinc-400">{movie.release_date?.substring(0, 4)}{movie.vote_average ? ` · ★ ${Number(movie.vote_average).toFixed(1)}` : ''}</p>
                        {movie.genres && movie.genres.length > 0 && (
                          <p className="text-xs text-zinc-500 mt-0.5">{movie.genres.slice(0, 2).map(g => genreLabel(g, lang)).join(', ')}</p>
                        )}
                        <p className="text-xs text-zinc-400 line-clamp-2 mt-1 leading-relaxed">{overviewOf(movie, lang)}</p>
                        {isInWatchlist(movie.tmdb_id) || addedMovies.has(movie.tmdb_id)
                          ? <p className="mt-2 text-xs text-emerald-400 font-medium">{t('✓ In your list')}</p>
                          : <button onClick={e => { e.stopPropagation(); addToWatchlist(movie) }}
                              className="mt-2 text-xs px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors cursor-pointer">
                              {t('+ Watchlist')}
                            </button>
                        }
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-zinc-800 px-6 py-4 shrink-0">
        <div className="flex gap-2.5">
          <input ref={inputRef} type="text" value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) } }}
            placeholder={isTv ? t('Ask about series, your list, stats…') : t('Ask about movies, your watchlist, stats…')}
            disabled={loading}
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-blue-500 disabled:opacity-50 transition-colors" />
          <button onClick={() => send(input)} disabled={loading || !input.trim()}
            className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold text-white transition-colors cursor-pointer shrink-0">
            {t('Send')}
          </button>
        </div>
        <p className="text-xs text-zinc-600 mt-2 text-center">{t('Press Enter to send')} · Gemini 2.5 Flash</p>
      </div>

      {detailMovie && (
        <MovieDetailModal
          kind={kind}
          movie={detailMovie}
          onClose={() => setDetailMovie(null)}
          onAdd={isInWatchlist(detailMovie.tmdb_id) || addedMovies.has(detailMovie.tmdb_id) ? undefined : () => { addToWatchlist(detailMovie); setDetailMovie(null) }}
          inWatchlist={isInWatchlist(detailMovie.tmdb_id) || addedMovies.has(detailMovie.tmdb_id)}
        />
      )}
    </div>
  )
}
