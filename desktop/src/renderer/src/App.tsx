import { useState, useEffect, useRef } from 'react'
import { onIdTokenChanged, User } from 'firebase/auth'
import { collection, onSnapshot } from 'firebase/firestore'
import { auth, db } from './firebase'
import Sidebar from './components/Sidebar'
import Watchlist from './pages/Watchlist'
import Stats from './pages/Stats'
import AIChat from './pages/AIChat'
import { TogetherWithBoundary } from './pages/Together'
import SettingsModal from './components/SettingsModal'
import AuthModal from './components/AuthModal'
import VerifyEmail from './components/VerifyEmail'
import { Page, ChatMessage, Movie, Kind } from './types'
import { TogetherSession, cleanupStaleSessions } from './services/together'
import { notifyDataChanged } from './services/events'
import { backfillTurkish } from './services/localization'
import { backfillAddedAt } from './services/addedAt'
import { useI18n } from './services/i18n'
import {
  syncAddMovie, syncAddWatchLog, isMigrated, markMigrated, collectionNames
} from './services/sync'

const KINDS: Kind[] = ['movie', 'tv']
const KIND_KEY = 'cinematrack:kind'

function initialKind(): Kind {
  try { return localStorage.getItem(KIND_KEY) === 'tv' ? 'tv' : 'movie' } catch { return 'movie' }
}

/**
 * Everything in the app (search, AI, sync, Watch Together) goes through the CinemaTrack API and the shared
 * Firebase project, which need a signed-in user with a verified email. So that is the front door.
 * It also hands the Firebase ID token to the main process, which makes the API calls.
 */
export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [, rerender] = useState(0)
  // The account the local database has been assigned to. Nothing may read or sync local data before it matches the
  // signed-in user, otherwise one account's list could end up in another's (see claimLocalDataFor in the main process).
  const [localFor, setLocalFor] = useState<string | null>(null)
  const [localFailed, setLocalFailed] = useState(false)

  useEffect(() => {
    const uid = user?.emailVerified ? user.uid : null
    if (!uid) { setLocalFor(null); setLocalFailed(false); return }
    let cancelled = false
    window.api.claimLocalData(uid)
      .then(() => { if (!cancelled) { setLocalFailed(false); setLocalFor(uid) } })
      .catch(e => { console.error('claiming local data failed:', e); if (!cancelled) setLocalFailed(true) })
    return () => { cancelled = true }
  }, [user?.uid, user?.emailVerified])

  useEffect(() => {
    const stop = onIdTokenChanged(auth, async u => {
      setUser(u)
      setLoaded(true)
      rerender(n => n + 1)   // `emailVerified` changes on the same user object after a reload
      await window.api.setAuthToken(u?.emailVerified ? await u.getIdToken() : null).catch(() => {})
    })
    // The main process asks for a fresh token when the one it holds is about to expire
    const stopRefresh = window.api.onAuthRefreshRequest(async () => {
      const u = auth.currentUser
      try { await window.api.setAuthToken(u?.emailVerified ? await u.getIdToken(true) : null) } catch { /* offline */ }
    })
    return () => { stop(); stopRefresh() }
  }, [])

  const shell = 'h-screen bg-zinc-950 text-zinc-100 overflow-y-auto select-none'
  if (!loaded) return <div className={`${shell} flex items-center justify-center text-zinc-500 text-sm`}>…</div>
  if (!user) return <div className={shell}><AuthModal onSuccess={() => {}} /></div>
  if (!user.emailVerified) return <div className={shell}><VerifyEmail user={user} onVerified={() => rerender(n => n + 1)} /></div>
  if (localFailed) return (
    <div className={`${shell} flex flex-col items-center justify-center gap-3 px-6 text-center`}>
      <p className="text-sm text-red-300">Could not prepare the data stored on this computer.</p>
      <button onClick={() => { void auth.signOut() }} className="text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer">Sign out</button>
    </div>
  )
  if (localFor !== user.uid) return <div className={`${shell} flex items-center justify-center text-zinc-500 text-sm`}>…</div>
  return <MainApp user={user} />
}

function MainApp({ user }: { user: User }) {
  const { t } = useI18n()
  const [page, setPage] = useState<Page>('watchlist')
  const [kind, setKindState] = useState<Kind>(initialKind)   // CinemaTrack (movies) or DiziTrack (series)
  const [showSettings, setShowSettings] = useState(false)
  // Chat and Watch Together state live here so they survive switching pages; one set per kind
  const [chatMessages, setChatMessages] = useState<Record<Kind, ChatMessage[]>>({ movie: [], tv: [] })
  const [togetherSessionId, setTogetherSessionId] = useState<Record<Kind, string | null>>({ movie: null, tv: null })
  const [togetherSession, setTogetherSession] = useState<Record<Kind, TogetherSession | null>>({ movie: null, tv: null })
  const [notification, setNotification] = useState<string | null>(null)
  const [syncStatus, setSyncStatus] = useState<string | null>(null)
  const unsubsRef = useRef<(() => void)[]>([])
  const migratingRef = useRef(false)
  const syncedUidRef = useRef<string | null>(null)   // the account the cloud sync is currently running for
  const tRef = useRef(t)
  tRef.current = t

  function setKind(k: Kind) {
    setKindState(k)
    try { localStorage.setItem(KIND_KEY, k) } catch { /* ignore */ }
  }

  function showNotif(msg: string) {
    setNotification(msg)
    setTimeout(() => setNotification(null), 4000)
  }

  function stopListeners() {
    unsubsRef.current.forEach(u => u())
    unsubsRef.current = []
  }

  useEffect(() => {
    // onIdTokenChanged (not onAuthStateChanged): it also fires when a user confirms their e-mail and the
    // token is refreshed, which is exactly when cloud sync is allowed to start.
    const unsub = onIdTokenChanged(auth, async user => {
      // The Firestore rules only let verified accounts in, so there is nothing to sync before that
      if (!user || !user.emailVerified) {
        stopListeners()
        syncedUidRef.current = null
        return
      }
      if (syncedUidRef.current === user.uid) return   // hourly token refresh: sync is already running
      syncedUidRef.current = user.uid
      void cleanupStaleSessions(user.uid)   // forgotten Watch Together sessions (see together.ts)

      // ── Step 1: One-time migration of existing SQLite data to Firestore (movies) ──
      if (!migratingRef.current) {
        migratingRef.current = true
        try {
          const alreadyMigrated = await isMigrated(user.uid)
          if (!alreadyMigrated) {
            setSyncStatus(tRef.current('Syncing your data to the cloud...'))
            const [watchlist, watchlog] = await Promise.all([
              window.api.getWatchlist(),
              window.api.getWatchLog()
            ])
            // Push watchlist
            for (const movie of watchlist) {
              await syncAddMovie(user.uid, movie).catch(() => {})
            }
            // Push watch history
            for (const entry of watchlog) {
              await syncAddWatchLog(user.uid, {
                log_id: entry.remote_id ?? String(entry.log_id),
                tmdb_id: entry.tmdb_id,
                title: entry.title,
                overview: entry.overview,
                poster_path: entry.poster_path,
                release_date: entry.release_date,
                genres: entry.genres,
                vote_average: entry.vote_average,
                runtime: entry.runtime ?? null,
                watched_at: entry.watched_at,
                rating: entry.rating,
                notes: entry.notes
              }).catch(() => {})
            }
            await markMigrated(user.uid)
            setSyncStatus(null)
            showNotif(tRef.current('☁️ {0} movies synced to cloud!', watchlist.length))
          }
        } catch (e) {
          console.error('Migration error:', e)
          setSyncStatus(null)
        } finally {
          migratingRef.current = false
        }
      }

      // ── Step 2: Real-time listeners — Firestore → SQLite, for movies and for series ──
      // When the phone adds/removes/logs something, the desktop updates automatically.
      stopListeners()
      for (const k of KINDS) {
        const names = collectionNames(k)

        // Watchlist
        unsubsRef.current.push(onSnapshot(
          collection(db, 'watchlists', user.uid, names.list),
          async snapshot => {
            let changed = false
            for (const change of snapshot.docChanges()) {
              if (change.type === 'added' || change.type === 'modified') {
                const movie = change.doc.data() as Movie
                const inList = await window.api.checkWatchlist(movie.tmdb_id, k)
                if (!inList && change.type === 'added') {
                  await window.api.addToWatchlist(movie, k).catch(() => {})
                  changed = true
                } else if (inList) {
                  // refresh the stored copy (e.g. the Turkish title another device just added)
                  await window.api.addToWatchlist(movie, k).catch(() => {})
                  if (change.type === 'modified' || movie.title_tr != null) changed = true
                }
                // When it was really added (a title added on the phone would otherwise be stamped with its arrival here)
                const cloudAddedAt = (change.doc.data() as { added_at?: string }).added_at
                if (cloudAddedAt && await window.api.setWatchlistAddedAt(movie.tmdb_id, cloudAddedAt, k).catch(() => false)) changed = true
              }
              if (change.type === 'removed') {
                const movie = change.doc.data()
                const wl = await window.api.getWatchlist(k)
                const entry = (wl as { tmdb_id: number; id: number }[]).find(m => m.tmdb_id === movie.tmdb_id)
                if (entry) {
                  await window.api.removeFromWatchlist(entry.id, k).catch(() => {})
                  changed = true
                }
              }
            }
            // the open page re-reads the local database (it only reads it once when it opens)
            if (changed) notifyDataChanged()
          },
          err => console.error('Watchlist listener error:', err)
        ))

        // Watch log — entries are matched by Firestore doc id (remote_id): nothing gets duplicated and
        // deletions on either device are mirrored. The watchlist itself is handled by the listener above.
        unsubsRef.current.push(onSnapshot(
          collection(db, 'watchlists', user.uid, names.log),
          async snapshot => {
            let changed = false
            for (const change of snapshot.docChanges()) {
              if (change.type === 'added' || change.type === 'modified') {
                const entry = change.doc.data()
                const res = await window.api.addRemoteWatchLog({
                  remoteId: change.doc.id,
                  watchedAt: entry.watched_at,
                  rating: entry.rating ?? null,
                  notes: entry.notes ?? null,
                  movie: {
                    tmdb_id: entry.tmdb_id, title: entry.title, overview: entry.overview || '',
                    poster_path: entry.poster_path ?? null, release_date: entry.release_date || '',
                    genres: entry.genres || [], vote_average: entry.vote_average || 0, runtime: entry.runtime ?? null,
                    title_tr: entry.title_tr ?? null, overview_tr: entry.overview_tr ?? null
                  }
                }, k).catch(() => null)
                if (res?.added || change.type === 'modified') changed = true
              }
              if (change.type === 'removed') {
                await window.api.removeRemoteWatchLog(change.doc.id, k).catch(() => {})
                changed = true
              }
            }
            if (changed) notifyDataChanged()
          },
          err => console.error('Watchlog listener error:', err)
        ))
      }

      // Entries saved before the Turkish copy existed: fill it in once, quietly
      backfillTurkish(user.uid)
      // Older titles have no added_at in the cloud yet: this computer knows it, so it fills the gaps once
      void backfillAddedAt(user.uid)
    })

    return () => {
      unsub()
      stopListeners()
    }
  }, [])

  // Same state setters, scoped to the current kind
  const setMessagesFor = (k: Kind): React.Dispatch<React.SetStateAction<ChatMessage[]>> => value =>
    setChatMessages(prev => ({
      ...prev,
      [k]: typeof value === 'function' ? (value as (p: ChatMessage[]) => ChatMessage[])(prev[k]) : value
    }))

  return (
    <div data-kind={kind} className="flex h-screen bg-zinc-950 text-zinc-100 overflow-hidden select-none">
      <Sidebar page={page} setPage={setPage} kind={kind} setKind={setKind} onSettings={() => setShowSettings(true)} />
      <main className="flex-1 overflow-hidden relative">
        {page === 'watchlist' && <Watchlist key={kind} kind={kind} />}
        {page === 'stats'     && <Stats key={kind} kind={kind} />}
        {page === 'ai'        && <AIChat key={kind} kind={kind} messages={chatMessages[kind]} setMessages={setMessagesFor(kind)} />}
        {page === 'together'  && (
          <TogetherWithBoundary
            key={kind}
            user={user}
            kind={kind}
            sessionId={togetherSessionId[kind]}
            setSessionId={id => setTogetherSessionId(prev => ({ ...prev, [kind]: id }))}
            session={togetherSession[kind]}
            setSession={s => setTogetherSession(prev => ({ ...prev, [kind]: s }))}
          />
        )}

        {/* Sync status */}
        {syncStatus && (
          <div className="absolute top-4 right-4 bg-zinc-800 border border-zinc-700 text-zinc-300 text-sm px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2">
            <span className="animate-spin">⟳</span> {syncStatus}
          </div>
        )}

        {/* Notification */}
        {notification && (
          <div className="absolute top-4 right-4 bg-emerald-800 border border-emerald-600 text-emerald-100 text-sm px-4 py-2.5 rounded-xl shadow-lg">
            {notification}
          </div>
        )}
      </main>
      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} onBeforeDelete={stopListeners} />
      )}
    </div>
  )
}
