import {
  collection, doc, setDoc, getDoc, updateDoc, onSnapshot,
  query, where, getDocs, deleteDoc, runTransaction, Timestamp
} from 'firebase/firestore'
import { db } from '../firebase'
import { Kind, Movie } from '../types'

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

function formatMovieList(movies: Movie[]): string {
  if (!movies.length) return 'Empty'
  return movies.map(m =>
    `- ${m.title} (${m.genres?.slice(0, 2).join(', ') || 'Unknown'})${m.vote_average ? ` ★${Number(m.vote_average).toFixed(1)}` : ''}${m.release_date ? ` [${m.release_date.substring(0, 4)}]` : ''}`
  ).join('\n')
}

// ── Main resolution logic — Gemini based ─────────────────────────────────────

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

    const hostChoice = creatorRandom ? 'Random' : `Prompt: ${creatorPref}`
    const user2Choice = partnerRandom ? 'Random' : `Prompt: ${partnerPref}`

    let prompt = `[TASK DESCRIPTION AND ROLE]
You are an expert movie assistant and recommendation engine working for the "Watch Together" feature of the "Cinematrack" app. Your goal is to analyze the watch histories (Watched), watchlists (Watchlist), and current preferences of two users (${session.creatorUsername} and ${session.partnerUsername}) to select the absolute best *single movie* that will satisfy them both.
When making your decision, you MUST STRICTLY FOLLOW THE RULES BELOW:

CASE 1: If both users selected "Random" (Pick from Watchlist):
1. Priority: Select a movie that is mutually present in BOTH users' Watchlists.
2. Alternative: If there is no common movie, select a movie present in ONLY ONE user's Watchlist, but ensure it strongly aligns with the OTHER user's taste by analyzing their previously watched movies (genre, year, rating).
3. Last Resort: If there are no suitable movies in either list, recommend a brand new movie that both users will love, based on a combined analysis of both their watch histories.

CASE 2: If one user selected "Random" and the other selected "Prompt" (Description):
1. Priority: Select a movie that is mutually present in BOTH users' Watchlists AND matches the provided Prompt.
2. Alternative: If not available, select a movie from the "Random" selector's Watchlist that matches the provided Prompt.
3. Last Resort: If there are no suitable movies in the lists, analyze both users' watch histories and recommend a brand new movie that STRICTLY MATCHES THE PROMPT.

CASE 3: If both users entered a "Prompt" (Description):
1. Priority: Select a movie that is mutually present in BOTH users' Watchlists AND simultaneously satisfies both Prompts.
2. Alternative: If not available, select a movie from EITHER user's Watchlist that satisfies both Prompts.
3. Last Resort: If not available in the lists, recommend a brand new movie that STRICTLY SATISFIES BOTH PROMPTS, taking both users' watch histories into account.

[INDEPENDENT RECOMMENDATION RULES (OUTSIDE WATCHLIST)]
If you cannot find a movie from the users' lists and must recommend one from your own database (as a Last Resort), adhere to these rules:
- The movie must be popular and widely acclaimed by general audiences.
- It must have a high audience/critic score (e.g., IMDb 7.0+).
- Avoid obscure or highly niche movies unless the users specifically request "experimental, obscure, indie" etc. in their prompts.

---
[USER DATA]
<${session.creatorUsername}_DATA>
Previously Watched:
${formatMovieList(creatorWatched)}
Watchlist:
${formatMovieList(creatorWatchlist)}
Choice: ${hostChoice}
</${session.creatorUsername}_DATA>

<${session.partnerUsername}_DATA>
Previously Watched:
${formatMovieList(partnerWatched)}
Watchlist:
${formatMovieList(partnerWatchlist)}
Choice: ${user2Choice}
</${session.partnerUsername}_DATA>

---
[RETURN MESSAGE FORMAT AND CLOSING]
For the application to process this data smoothly, you MUST return your response ONLY in the following JSON format. Do not use any extra text, explanations, or markdown blocks outside of the JSON. ${language === 'tr-TR' ? 'Write the "reasoning" text in Turkish.' : 'Write the "reasoning" text in English.'} Keep "title" in its original/English form.
{
  "recommended_movie": {
    "title": "Movie Title",
    "year": "Release Year",
    "genre": "Genres",
    "reasoning": "A short, engaging explanation addressed to the users detailing why this movie was chosen and how it matches their tastes or prompts.",
    "source": "Both Watchlists | ${session.creatorUsername} Watchlist | ${session.partnerUsername} Watchlist | Gemini Recommendation"
  }
}`

    if (kind === 'tv') {
      // same rules, but for TV series (the JSON key stays as it is)
      prompt = prompt.replace(/recommended_movie/g, '@@KEY@@')
        .replace(/movies/g, 'TV series').replace(/Movie Title/g, 'Series Title')
        .replace(/movie/g, 'TV series').replace(/Movie/g, 'TV series')
        .replace(/@@KEY@@/g, 'recommended_movie')
    }

    console.log('=== FULL PROMPT SENT TO GEMINI ===\n', prompt)

    const result = await window.api.togetherResolve({
      kind,
      geminiPrompt: prompt,
      creatorUsername: session.creatorUsername,
      partnerUsername: session.partnerUsername,
      creatorList: creatorWatchlist,
      partnerList: partnerWatchlist
    })

    console.log('=== RESULT FROM IPC ===\n', JSON.stringify(result, null, 2))

    await writeResult(session.id, result as ResolvedMovie | null)
  } catch (e) {
    console.error('resolveSession error:', e)
    await writeResult(session.id, null)
  }
}

async function writeResult(sessionId: string, result: ResolvedMovie | null): Promise<void> {
  await updateDoc(doc(db, 'sessions', sessionId), { result, status: 'resolved' })
}

export function listenSession(sid: string, cb: (s: TogetherSession | null) => void): () => void {
  return onSnapshot(doc(db, 'sessions', sid), snap => cb(snap.exists() ? snap.data() as TogetherSession : null))
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
