import { useState, useEffect, useRef, Component, ReactNode } from 'react'
import { User } from 'firebase/auth'
import MovieDetailModal from '../components/MovieDetailModal'
import { logout } from '../services/auth'
import {
  createSession, joinSession, submitPreference, submitVote,
  listenSession, deleteSession, deleteOwnPayload, SessionError,
  TogetherSession, ResolvedMovie
} from '../services/together'
import { syncAddMovie } from '../services/sync'
import { apiCodeText } from '../services/apiError'
import { Kind, Movie } from '../types'
import { useI18n, titleOf, overviewOf, genreLabel } from '../services/i18n'

function ResultCard({ movie, kind, session, userId, onAddWatchlist, onVote, added }: {
  movie: ResolvedMovie; kind: Kind; session: TogetherSession; userId: string
  onAddWatchlist: () => void; onVote: (v: 'ok' | 'again') => void; added: boolean
}) {
  const { t, lang } = useI18n()
  const [detail, setDetail] = useState(false)
  const posterUrl = movie.poster_path ? `https://image.tmdb.org/t/p/w342${movie.poster_path}` : null
  const isCreator = userId === session.creatorId
  const myVote = isCreator ? session.creatorVote : session.partnerVote
  const otherVote = isCreator ? session.partnerVote : session.creatorVote
  const partnerName = isCreator ? session.partnerUsername : session.creatorUsername
  const title = titleOf(movie, lang)

  const sourceColors: Record<string, string> = {
    'Both Watchlists':       'bg-emerald-900/40 border-emerald-700 text-emerald-300',
    'Host Watchlist':        'bg-blue-900/40 border-blue-700 text-blue-300',
    'User2 Watchlist':       'bg-blue-900/40 border-blue-700 text-blue-300',
    'Gemini Recommendation': 'bg-purple-900/40 border-purple-700 text-purple-300'
  }
  const sourceIcons: Record<string, string> = {
    'Both Watchlists':       '✓✓',
    'Host Watchlist':        '✓',
    'User2 Watchlist':       '✓',
    'Gemini Recommendation': '✨'
  }
  const colorClass = sourceColors[movie.source] || 'bg-purple-900/40 border-purple-700 text-purple-300'
  const icon = sourceIcons[movie.source] || '✨'

  // The label was written by whoever resolved the session, in English: show it in our language
  let sourceLabel = movie.sourceLabel
  if (movie.source === 'Both Watchlists') sourceLabel = t('In both watchlists')
  else if (movie.source === 'Host Watchlist') sourceLabel = t("From {0}'s watchlist", session.creatorUsername)
  else if (movie.source === 'User2 Watchlist') sourceLabel = t("From {0}'s watchlist", session.partnerUsername ?? '')
  else if (movie.source === 'Gemini Recommendation') sourceLabel = t('Gemini Recommendation')

  const voteBadge = (v: 'ok' | 'again') => (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${v === 'ok' ? 'bg-emerald-900/50 text-emerald-400' : 'bg-zinc-700 text-zinc-300'}`}>
      {v === 'ok' ? t("✓ Let's watch this!") : t('🔄 Search again')}
    </span>
  )

  return (
    <div className="space-y-3">
      <div className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${colorClass}`}>
        {icon} {sourceLabel}
      </div>

      <div className="flex gap-4 p-4 bg-zinc-800 border border-zinc-700 rounded-2xl cursor-pointer hover:border-zinc-600 transition-colors"
        onClick={() => setDetail(true)}>
        {posterUrl
          ? <img src={posterUrl} alt={title} className="w-24 rounded-xl object-cover shrink-0" style={{ aspectRatio: '2/3' }} />
          : <div className="w-24 rounded-xl bg-zinc-700 shrink-0 flex items-center justify-center text-3xl" style={{ aspectRatio: '2/3' }}>🎬</div>
        }
        <div className="flex-1 min-w-0 pt-1">
          <h3 className="text-lg font-bold text-white">{title}</h3>
          <div className="flex gap-3 text-xs text-zinc-400 mt-1">
            <span>{movie.release_date?.substring(0, 4)}</span>
            {movie.vote_average ? <span className="text-yellow-400">★ {Number(movie.vote_average).toFixed(1)}</span> : null}
          </div>
          {movie.genres?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {movie.genres.slice(0, 3).map(g => <span key={g} className="text-xs px-1.5 py-0.5 bg-zinc-700 text-zinc-300 rounded">{genreLabel(g, lang)}</span>)}
            </div>
          )}
          <p className="text-xs text-zinc-400 mt-2 line-clamp-2 leading-relaxed">{overviewOf(movie, lang)}</p>
          {!added
            ? <button onClick={e => { e.stopPropagation(); onAddWatchlist() }}
                className="mt-3 text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors cursor-pointer">
                {t('+ Add to List')}
              </button>
            : <p className="mt-3 text-xs text-emerald-400">{t('✓ Added to your list')}</p>
          }
        </div>
      </div>

      {/* Reasoning */}
      {movie.reasoning && (
        <div className="p-3 bg-zinc-800/50 border border-zinc-700/50 rounded-xl">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1">{kind === 'tv' ? t('Why this series?') : t('Why this movie?')}</p>
          <p className="text-xs text-zinc-300 leading-relaxed">{movie.reasoning}</p>
        </div>
      )}

      {/* Voting */}
      <div className="p-4 bg-zinc-800/60 border border-zinc-700 rounded-xl">
        <p className="text-xs text-zinc-400 mb-3">{t('What do you think?')}</p>
        {!myVote ? (
          <div className="flex gap-2">
            <button onClick={() => onVote('ok')}
              className="flex-1 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-sm font-semibold text-white transition-colors cursor-pointer">
              {t("✓ Let's watch this!")}
            </button>
            <button onClick={() => onVote('again')}
              className="flex-1 py-2.5 rounded-xl bg-zinc-700 hover:bg-zinc-600 text-sm font-semibold text-zinc-200 transition-colors cursor-pointer">
              {t('🔄 Search again')}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400">{t('You:')}</span>
              {voteBadge(myVote)}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400">{partnerName}:</span>
              {otherVote ? voteBadge(otherVote) : <span className="text-xs text-zinc-500">{t('Waiting…')}</span>}
            </div>
            {myVote === 'ok' && !otherVote && (
              <p className="text-xs text-zinc-500 mt-1">{t("Waiting for {0}'s decision…", partnerName ?? '')}</p>
            )}
          </div>
        )}
      </div>

      {detail && <MovieDetailModal kind={kind} movie={movie} onClose={() => setDetail(false)} onAdd={onAddWatchlist} />}
    </div>
  )
}

interface Props {
  /** The signed-in account with a verified email: the app only shows this page to someone who is (see App.tsx). */
  user: User
  kind: Kind
  sessionId: string | null
  setSessionId: (id: string | null) => void
  session: TogetherSession | null
  setSession: (s: TogetherSession | null) => void
}

export default function Together({ user, kind, sessionId, setSessionId, session, setSession }: Props) {
  const { t, tmdbLang } = useI18n()
  const isTv = kind === 'tv'
  const [joinCode, setJoinCode]     = useState('')
  const [preference, setPref]       = useState('')
  const [isRandom, setIsRandom]     = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [creating, setCreating]     = useState(false)
  const [joining, setJoining]       = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [added, setAdded]           = useState(false)
  const unsubRef = useRef<(() => void) | null>(null)

  // Only reconnect if App.tsx remembers a sessionId — no automatic searching
  useEffect(() => {
    if (sessionId) subscribeSession(sessionId)
  }, [])

  function subscribeSession(id: string) {
    if (unsubRef.current) unsubRef.current()
    unsubRef.current = listenSession(id, s => {
      if (s === null) {
        // Session was deleted from Firestore (both said OK, or someone left)
        if (user) deleteOwnPayload(id, user.uid)
        setSession(null)
        setSessionId(null)
        setPref('')
        setIsRandom(false)
        setAdded(false)
        return
      }
      setSession(s)
      if (s.status === 'both_joined') {
        setPref(''); setIsRandom(false)
      }
    })
  }

  useEffect(() => () => { unsubRef.current?.() }, [])

  async function handleCreate() {
    setCreating(true); setError(null)
    try {
      const id = await createSession(user.uid, user.displayName || user.uid, kind)
      setSessionId(id); subscribeSession(id)
    } catch { setError(t('Could not create the session.')) }
    finally { setCreating(false) }
  }

  async function handleJoin() {
    if (!joinCode.trim()) return
    setJoining(true); setError(null)
    try {
      const code = joinCode.trim().toUpperCase()
      await joinSession(code, user.uid, user.displayName || user.uid, kind, {
        notFound: t('Session not found. Check the code.'),
        own: t("That's your own session — share the code with your partner."),
        full: t('This session is already full.'),
        wrongKind: isTv
          ? t('That code is for a movie session — open CinemaTrack to join.')
          : t('That code is for a series session — open DiziTrack to join.')
      })
      setSessionId(code); subscribeSession(code)
    } catch (e) { setError(e instanceof SessionError ? e.message : t('Could not join the session. Check your connection and the code.')) }
    finally { setJoining(false) }
  }

  async function handleSubmit() {
    if (!session) return
    setSubmitting(true); setError(null)
    try {
      const pref = isRandom ? 'random' : preference.trim() || 'anything'
      await submitPreference(session, user.uid, pref, isRandom, tmdbLang)
    } catch { setError(t('Could not send. Try again.')) }
    finally { setSubmitting(false) }
  }

  async function handleVote(vote: 'ok' | 'again') {
    if (!session) return
    if (vote === 'again') setAdded(false)
    await submitVote(session, user.uid, vote)
    // after "again" the state resets via listenSession (status=both_joined)
  }

  async function handleLeave() {
    if (unsubRef.current) unsubRef.current()
    // Delete the session from Firestore
    if (sessionId) await deleteSession(sessionId)
    setSession(null); setSessionId(null)
    setJoinCode(''); setPref(''); setAdded(false)
  }

  async function handleAddToWatchlist(movie: Movie) {
    await window.api.addToWatchlist(movie, kind)
    await syncAddMovie(user.uid, movie, kind)
    setAdded(true)
  }

  const isCreator = session?.creatorId === user.uid
  const mySubmitted = session ? (isCreator
    ? ['creator_ready', 'resolving', 'resolved'].includes(session.status)
    : ['partner_ready', 'resolving', 'resolved'].includes(session.status)) : false
  const partnerSubmitted = session ? (isCreator
    ? ['partner_ready', 'resolving', 'resolved'].includes(session.status)
    : ['creator_ready', 'resolving', 'resolved'].includes(session.status)) : false
  const partnerName = isCreator ? session?.partnerUsername : session?.creatorUsername

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-6 pt-8 pb-10 max-w-xl">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-bold text-white">{t('Watch Together')}</h1>
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400">👤 {user.displayName}</span>
            <button onClick={logout} className="text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer">{t('Sign out')}</button>
          </div>
        </div>
        <p className="text-sm text-zinc-400 mb-6">
          {isTv ? t('Find the perfect series for both of you') : t('Find the perfect movie for both of you')}
        </p>

        {error && <div className="mb-4 px-3 py-2 bg-red-900/30 border border-red-800 rounded-lg text-xs text-red-300">{error}</div>}

        {/* No session — main menu */}
        {!sessionId && (
          <div className="space-y-4">
            <div className="p-5 bg-zinc-800 border border-zinc-700 rounded-2xl">
              <p className="text-sm font-semibold text-white mb-1">{t('Start a session')}</p>
              <p className="text-xs text-zinc-400 mb-4">{t('Create a code and share it with your partner')}</p>
              <button onClick={handleCreate} disabled={creating}
                className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-sm font-semibold text-white transition-colors cursor-pointer">
                {creating ? t('Creating…') : t('🎬 Create Session')}
              </button>
            </div>
            <div className="p-5 bg-zinc-800 border border-zinc-700 rounded-2xl">
              <p className="text-sm font-semibold text-white mb-1">{t('Join a session')}</p>
              <p className="text-xs text-zinc-400 mb-4">{t('Enter the 6-letter code your partner shared')}</p>
              <div className="flex gap-2">
                <input type="text" value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="ABC123" maxLength={6}
                  className="flex-1 bg-zinc-700 border border-zinc-600 rounded-xl px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-blue-500 font-mono tracking-widest uppercase" />
                <button onClick={handleJoin} disabled={joining || joinCode.length < 6}
                  className="px-4 py-2.5 rounded-xl bg-zinc-600 hover:bg-zinc-500 disabled:opacity-40 text-sm font-semibold text-white transition-colors cursor-pointer">
                  {joining ? '…' : t('Join')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Waiting for the partner */}
        {sessionId && session?.status === 'waiting' && (
          <div className="p-5 bg-zinc-800 border border-zinc-700 rounded-2xl text-center">
            <p className="text-3xl mb-3">⏳</p>
            <p className="text-sm font-semibold text-white mb-1">{t('Waiting for your partner to join')}</p>
            <p className="text-xs text-zinc-400 mb-4">{t('Share this code:')}</p>
            <div className="inline-flex items-center gap-2 bg-zinc-700 px-4 py-2 rounded-xl mb-4">
              <span className="text-2xl font-bold text-white tracking-widest font-mono">{sessionId}</span>
            </div>
            <p className="text-xs text-zinc-500">{t('Watch Together → Join a session → enter the code')}</p>
            <button onClick={handleLeave} className="mt-4 text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer block mx-auto">{t('Cancel')}</button>
          </div>
        )}

        {/* Both joined — enter preferences */}
        {sessionId && session && ['both_joined', 'creator_ready', 'partner_ready'].includes(session.status) && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 p-3 bg-zinc-800 border border-zinc-700 rounded-xl">
              <span className="text-sm">🟢</span>
              <p className="text-xs text-zinc-300">{t('Session with')} <span className="font-semibold text-white">{partnerName}</span></p>
              <div className="flex gap-2 ml-auto">
                <span className={`text-xs px-2 py-0.5 rounded-full ${mySubmitted ? 'bg-emerald-900/50 text-emerald-400' : 'bg-zinc-700 text-zinc-400'}`}>{t('You')} {mySubmitted ? '✓' : '…'}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${partnerSubmitted ? 'bg-emerald-900/50 text-emerald-400' : 'bg-zinc-700 text-zinc-400'}`}>{partnerName} {partnerSubmitted ? '✓' : '…'}</span>
              </div>
            </div>

            {!mySubmitted ? (
              <div className="p-5 bg-zinc-800 border border-zinc-700 rounded-2xl">
                <p className="text-sm font-semibold text-white mb-4">{isTv ? t('What do you want to watch? (series)') : t('What do you want to watch?')}</p>
                <button onClick={() => setIsRandom(r => !r)}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border mb-4 transition-colors cursor-pointer ${isRandom ? 'bg-blue-900/30 border-blue-600 text-blue-300' : 'bg-zinc-700/50 border-zinc-600 text-zinc-400 hover:border-zinc-500'}`}>
                  <span className="text-lg">🎲</span>
                  <div className="text-left">
                    <p className="text-xs font-semibold">{t('Surprise me from my list')}</p>
                    <p className="text-xs opacity-70">{t('Random pick — no AI suggestion')}</p>
                  </div>
                  <div className={`ml-auto w-4 h-4 rounded-full border-2 ${isRandom ? 'bg-blue-500 border-blue-500' : 'border-zinc-500'}`} />
                </button>
                {!isRandom && (
                  <textarea value={preference} onChange={e => setPref(e.target.value)}
                    placeholder={isTv ? t('e.g. crime drama, comedy, short seasons…') : t("e.g. horror, comedy, 90's action…")}
                    rows={3}
                    className="w-full bg-zinc-700 border border-zinc-600 rounded-xl px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-blue-500 resize-none mb-4" />
                )}
                <button onClick={handleSubmit} disabled={submitting || (!isRandom && !preference.trim())}
                  className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-sm font-semibold text-white transition-colors cursor-pointer">
                  {submitting ? t('Sending…') : t('Submit →')}
                </button>
              </div>
            ) : (
              <div className="p-5 bg-zinc-800 border border-zinc-700 rounded-2xl text-center">
                <p className="text-2xl mb-2">✓</p>
                <p className="text-sm text-zinc-300">{t('Your preference was sent.')}</p>
                <p className="text-xs text-zinc-500 mt-1"><span className="text-zinc-300">{partnerName}</span> {t('is still choosing…')}</p>
              </div>
            )}
            <button onClick={handleLeave} className="text-xs text-zinc-600 hover:text-zinc-400 cursor-pointer">{t('Leave session')}</button>
          </div>
        )}

        {/* Resolving */}
        {session?.status === 'resolving' && (
          <div className="p-5 bg-zinc-800 border border-zinc-700 rounded-2xl text-center">
            <p className="text-2xl mb-2">🔍</p>
            <p className="text-sm text-zinc-300">{isTv ? t('Finding the perfect series…') : t('Finding the perfect movie…')}</p>
          </div>
        )}

        {/* Result found */}
        {session?.status === 'resolved' && session.result && (
          <div>
            <p className="text-base font-semibold text-white mb-3">{isTv ? t('🎉 Series found!') : t('🎉 Movie found!')}</p>
            <ResultCard
              movie={session.result}
              kind={kind}
              session={session}
              userId={user.uid}
              onAddWatchlist={() => handleAddToWatchlist(session.result!)}
              onVote={handleVote}
              added={added}
            />
            <button onClick={handleLeave} className="text-xs text-zinc-600 hover:text-zinc-400 cursor-pointer mt-4 block">{t('Leave session')}</button>
          </div>
        )}

        {/* No result */}
        {session?.status === 'resolved' && !session.result && (
          <div className="p-5 bg-zinc-800 border border-zinc-700 rounded-2xl text-center">
            <p className="text-zinc-400 text-sm">{apiCodeText(session.error, t) ?? t('No match found. Try different preferences.')}</p>
            <button onClick={() => handleVote('again')} className="mt-3 text-xs text-blue-400 hover:text-blue-300 cursor-pointer">{t('Search again')}</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Error boundary ────────────────────────────────────────────────────────────

class TogetherErrorBoundary extends Component<{ children: ReactNode; title: string; retry: string }, { error: string | null }> {
  constructor(p: { children: ReactNode; title: string; retry: string }) {
    super(p)
    this.state = { error: null }
  }
  static getDerivedStateFromError(e: Error) { return { error: e.message } }
  render() {
    if (this.state.error) return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-zinc-500 px-6">
        <p className="text-sm text-red-400">{this.props.title}</p>
        <p className="text-xs text-zinc-600 text-center">{this.state.error}</p>
        <button onClick={() => this.setState({ error: null })} className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer">{this.props.retry}</button>
      </div>
    )
    return this.props.children
  }
}

export function TogetherWithBoundary(props: Props) {
  const { t } = useI18n()
  return (
    <TogetherErrorBoundary title={t('Watch Together could not be loaded')} retry={t('Try again')}>
      <Together {...props} />
    </TogetherErrorBoundary>
  )
}
