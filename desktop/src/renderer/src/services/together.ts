import {
  collection, doc, setDoc, getDoc, updateDoc, onSnapshot,
  query, where, getDocs, deleteDoc, runTransaction, Timestamp
} from 'firebase/firestore'
import { db } from '../firebase'
import { Kind, Movie } from '../types'
import { apiErrorCode } from './apiError'

export type SessionStatus =
  | 'waiting'
  | 'both_joined'
  | 'creator_ready'
  | 'partner_ready'
  | 'resolving'
  | 'resolved'

export interface TogetherSession {
  id: string
  kind?: Kind            // 'movie' (default when missing) or 'tv'
  creatorId: string
  creatorUsername: string
  partnerId: string | null
  partnerUsername: string | null
  status: SessionStatus
  creatorPreference: string | null
  partnerPreference: string | null
  creatorIsRandom: boolean
  partnerIsRandom: boolean
  result: ResolvedMovie | null
  error?: string | null  // why there is no result: an API error code such as "rate_limited" (see apiError.ts)
  createdAt: string
  creatorVote: 'ok' | 'again' | null
  partnerVote: 'ok' | 'again' | null
}

export interface ResolvedMovie extends Movie {
  source: 'Both Watchlists' | 'Host Watchlist' | 'User2 Watchlist' | 'Gemini Recommendation'
  sourceLabel: string
  reasoning: string
}

// 6 characters from A-Z0-9: the Firestore rules only accept ids of exactly this shape
const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
function sessionId(): string {
  const bytes = new Uint32Array(6)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, n => CODE_CHARS[n % CODE_CHARS.length]).join('')
}

// Sessions and summaries are throw-away: a Firestore TTL policy on `expireAt` removes forgotten ones
const SESSION_TTL_MS = 2 * 24 * 3600 * 1000
const PAYLOAD_TTL_MS = 24 * 3600 * 1000

export async function createSession(creatorId: string, creatorUsername: string, kind: Kind): Promise<string> {
  const id = sessionId()
  await setDoc(doc(db, 'sessions', id), {
    id, kind, creatorId, creatorUsername,
    partnerId: null, partnerUsername: null,
    status: 'waiting',
    creatorPreference: null, partnerPreference: null,
    creatorIsRandom: false, partnerIsRandom: false,
    result: null,
    createdAt: new Date().toISOString(),
    expireAt: Timestamp.fromMillis(Date.now() + SESSION_TTL_MS),
    creatorVote: null, partnerVote: null
  })
  return id
}

// ── Each member's short-lived summary ────────────────────────────────────────
// Watch Together needs both people's lists, but lists are private (Firestore rules: owner only).
// So each member publishes a summary into the session. Only the two members can read it, and it never
// contains notes. It is deleted when the session ends.

interface Payload { watchlist: Movie[]; watched: Movie[] }

function toSummary(m: Movie): Movie {
  return {
    tmdb_id: m.tmdb_id, title: m.title, title_tr: m.title_tr ?? null, overview: m.overview ?? '',
    poster_path: m.poster_path ?? null, release_date: m.release_date ?? '', genres: m.genres ?? [],
    vote_average: m.vote_average ?? 0, runtime: m.runtime ?? null
  }
}

async function publishPayload(sid: string, uid: string, kind: Kind): Promise<void> {
  const [wl, log] = await Promise.all([window.api.getWatchlist(kind), window.api.getWatchLog(kind)])
  const watchlist = wl.slice(0, 300).map(toSummary)
  const watched = [...log]
    .sort((a, b) => (b.watched_at || '').localeCompare(a.watched_at || ''))
    .slice(0, 100)
    .map(l => ({ ...toSummary(l), overview: '', poster_path: null, rating: l.rating ?? null }))
  await setDoc(doc(db, 'sessions', sid, 'payload', uid), {
    uid, kind, watchlist, watched,
    createdAt: Timestamp.now(),
    expireAt: Timestamp.fromMillis(Date.now() + PAYLOAD_TTL_MS)
  })
}

async function readPayload(sid: string, uid: string): Promise<Payload> {
  const snap = await getDoc(doc(db, 'sessions', sid, 'payload', uid))
  const d = snap.data() as Partial<Payload> | undefined
  return { watchlist: d?.watchlist ?? [], watched: d?.watched ?? [] }
}

/** Remove our own summary after the session has ended (the other member's device does the same for theirs). */
export async function deleteOwnPayload(sid: string, uid: string): Promise<void> {
  try { await deleteDoc(doc(db, 'sessions', sid, 'payload', uid)) } catch { /* the TTL policy removes leftovers */ }
}

async function deletePayloads(sid: string): Promise<void> {
  try {
    const snap = await getDocs(collection(db, 'sessions', sid, 'payload'))
    await Promise.all(snap.docs.map(d => deleteDoc(d.ref)))
  } catch { /* best effort: the TTL policy removes leftovers */ }
}

// Errors whose message is safe to show to the user as-is
export class SessionError extends Error {}

export interface JoinMessages { notFound: string; own: string; full: string; wrongKind: string }

export async function joinSession(
  sid: string, partnerId: string, partnerUsername: string, kind: Kind, msg: JoinMessages
): Promise<void> {
  const ref = doc(db, 'sessions', sid)
  await runTransaction(db, async tx => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new SessionError(msg.notFound)
    const s = snap.data() as TogetherSession
    if ((s.kind ?? 'movie') !== kind) throw new SessionError(msg.wrongKind)   // sessions without a kind are movie sessions
    if (s.creatorId === partnerId) throw new SessionError(msg.own)
    if (s.partnerId) throw new SessionError(msg.full)
    tx.update(ref, { partnerId, partnerUsername, status: 'both_joined' })
  })
}

// Delete the session completely (leave or cancel)
export async function deleteSession(sid: string): Promise<void> {
  await deletePayloads(sid)   // first: once the session is gone, members can no longer list its summaries
  try { await deleteDoc(doc(db, 'sessions', sid)) } catch { /* ignore */ }
}

export async function submitPreference(
  session: TogetherSession,
  userId: string,
  preference: string,
  isRandom: boolean,
  language: 'tr-TR' | 'en-US'
): Promise<void> {
  const isCreator = userId === session.creatorId

  // Publish our summary first: whoever submits second resolves the session and reads both
  await publishPayload(session.id, userId, session.kind ?? 'movie')

  const updates: Record<string, unknown> = isCreator
    ? { creatorPreference: preference, creatorIsRandom: isRandom }
    : { partnerPreference: preference, partnerIsRandom: isRandom }

  await updateDoc(doc(db, 'sessions', session.id), updates)

  // Exactly one device resolves: whoever flips the status to 'resolving' inside the transaction.
  // If the partner hasn't submitted yet we just mark ourselves as ready.
  const ref = doc(db, 'sessions', session.id)
  const claimed = await runTransaction(db, async tx => {
    const snap = await tx.get(ref)
    if (!snap.exists()) return null
    const fresh = snap.data() as TogetherSession
    const bothReady = fresh.creatorPreference !== null && fresh.partnerPreference !== null
    if (bothReady) {
      if (fresh.status === 'resolving' || fresh.status === 'resolved') return null
      tx.update(ref, { status: 'resolving' })
      return fresh
    }
    tx.update(ref, { status: isCreator ? 'creator_ready' : 'partner_ready' })
    return null
  })

  if (claimed) {
    console.log('Both submitted — resolving session')
    await resolveSession(
      claimed,
      claimed.creatorPreference!,
      claimed.partnerPreference!,
      claimed.creatorIsRandom,
      claimed.partnerIsRandom,
      language
    )
  }
}

export async function submitVote(session: TogetherSession, userId: string, vote: 'ok' | 'again'): Promise<void> {
  const isCreator = userId === session.creatorId
  const field = isCreator ? 'creatorVote' : 'partnerVote'
  const otherVote = isCreator ? session.partnerVote : session.creatorVote

  if (vote === 'again') {
    // Someone said "again" — reset the session back to the preference step
    await updateDoc(doc(db, 'sessions', session.id), {
      status: 'both_joined',
      result: null,
      error: null,
      creatorPreference: null,
      partnerPreference: null,
      creatorIsRandom: false,
      partnerIsRandom: false,
      creatorVote: null,
      partnerVote: null
    })
  } else if (vote === 'ok' && otherVote === 'ok') {
    // Both said "ok" — delete the session
    await deleteSession(session.id)
  } else {
    // First "ok" — just record it
    await updateDoc(doc(db, 'sessions', session.id), { [field]: vote })
  }
}

/** What the AI gets to see about a title: nothing but the facts needed to judge taste. */
function toAiItem(m: Movie & { rating?: number | null }) {
  return {
    title: m.title, genres: m.genres, vote_average: m.vote_average,
    release_date: m.release_date, rating: m.rating ?? null
  }
}

// ── Main resolution logic — the CinemaTrack API asks Gemini ──────────────────

async function resolveSession(
  session: TogetherSession,
  creatorPref: string,
  partnerPref: string,
  creatorRandom: boolean,
  partnerRandom: boolean,
  language: 'tr-TR' | 'en-US'
): Promise<void> {
  const kind: Kind = session.kind ?? 'movie'
  try {
    // Each member published a summary (watchlist + newest 100 watched) when they submitted. A missing one,
    // e.g. from an old app version, just counts as empty.
    const [creator, partner] = await Promise.all([
      readPayload(session.id, session.creatorId).catch(() => ({ watchlist: [], watched: [] }) as Payload),
      readPayload(session.id, session.partnerId!).catch(() => ({ watchlist: [], watched: [] }) as Payload)
    ])
    const { watchlist: creatorWatchlist, watched: creatorWatched } = creator
    const { watchlist: partnerWatchlist, watched: partnerWatched } = partner

    // The CinemaTrack API builds the prompt: we only send data. Notes never get this far: the summaries
    // that were published for the session hold titles, genres and ratings only.
    const person = (name: string, random: boolean, pref: string, watched: Movie[], watchlist: Movie[]) => ({
      name, random, prompt: random ? '' : pref,
      watched: watched.map(toAiItem),
      watchlist: watchlist.map(toAiItem)
    })

    const result = await window.api.togetherResolve({
      kind,
      language,
      users: [
        person(session.creatorUsername, creatorRandom, creatorPref, creatorWatched, creatorWatchlist),
        person(session.partnerUsername ?? 'Partner', partnerRandom, partnerPref, partnerWatched, partnerWatchlist)
      ],
      creatorUsername: session.creatorUsername,
      partnerUsername: session.partnerUsername,
      creatorList: creatorWatchlist,
      partnerList: partnerWatchlist
    })

    await writeResult(session.id, result as ResolvedMovie | null)
  } catch (e) {
    console.error('resolveSession error:', e)
    // Tell both people why there is no result (for instance "daily limit reached") instead of just "no match"
    await writeResult(session.id, null, apiErrorCode(e))
  }
}

async function writeResult(sessionId: string, result: ResolvedMovie | null, error: string | null = null): Promise<void> {
  await updateDoc(doc(db, 'sessions', sessionId), { result, status: 'resolved', error })
}

export function listenSession(sid: string, cb: (s: TogetherSession | null) => void): () => void {
  return onSnapshot(doc(db, 'sessions', sid), snap => cb(snap.exists() ? snap.data() as TogetherSession : null))
}

/**
 * Removes this user's abandoned sessions (and the summaries inside them) once they are past their `expireAt`.
 * Firestore's own TTL feature needs a paid plan, so the apps tidy up after themselves when they start.
 */
export async function cleanupStaleSessions(uid: string): Promise<void> {
  try {
    for (const d of await sessionsOf(uid)) {
      const data = d.data() as { expireAt?: Timestamp; createdAt?: string }
      const expires = data.expireAt?.toMillis() ?? (Date.parse(data.createdAt ?? '') + SESSION_TTL_MS)
      if (Number.isFinite(expires) && expires < Date.now()) await deleteSession(d.id)
    }
  } catch { /* best effort: try again next start */ }
}

/** Removes every Watch Together session this user is in (used when the account is deleted). Throws on failure. */
export async function deleteAllSessions(uid: string): Promise<void> {
  for (const d of await sessionsOf(uid)) {
    await deletePayloads(d.id)
    await deleteDoc(d.ref)
  }
}

async function sessionsOf(uid: string) {
  const [asCreator, asPartner] = await Promise.all([
    getDocs(query(collection(db, 'sessions'), where('creatorId', '==', uid))),
    getDocs(query(collection(db, 'sessions'), where('partnerId', '==', uid)))
  ])
  return [...asCreator.docs, ...asPartner.docs]
}

export async function getActiveSession(uid: string): Promise<TogetherSession | null> {
  try {
    // sessions the user created, and sessions the user joined
    const q1 = query(collection(db, 'sessions'), where('creatorId', '==', uid))
    const q2 = query(collection(db, 'sessions'), where('partnerId', '==', uid))
    const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)])
    const all = [
      ...snap1.docs.map(d => d.data() as TogetherSession),
      ...snap2.docs.map(d => d.data() as TogetherSession)
    ]
    // first session that is not resolved yet
    return all.find(s => s.status !== 'resolved') ?? null
  } catch { return null }
}
