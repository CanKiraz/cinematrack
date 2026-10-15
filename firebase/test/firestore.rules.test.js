import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import {
  initializeTestEnvironment, assertFails, assertSucceeds
} from '@firebase/rules-unit-testing'
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs, collection, query, where
} from 'firebase/firestore'

const rules = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../firestore.rules'), 'utf8')

let env

// Auth contexts: alice and bob are verified, mallory is verified but not in any session, eve has not verified her e-mail
const as = {
  alice: () => env.authenticatedContext('alice', { email: 'alice@example.com', email_verified: true }).firestore(),
  bob: () => env.authenticatedContext('bob', { email: 'bob@example.com', email_verified: true }).firestore(),
  mallory: () => env.authenticatedContext('mallory', { email: 'm@example.com', email_verified: true }).firestore(),
  eve: () => env.authenticatedContext('eve', { email: 'eve@example.com', email_verified: false }).firestore(),
  anon: () => env.unauthenticatedContext().firestore()
}

const waitingSession = {
  id: 'ABC123', kind: 'movie', creatorId: 'alice', creatorUsername: 'alice',
  partnerId: null, partnerUsername: null, status: 'waiting',
  creatorPreference: null, partnerPreference: null,
  creatorIsRandom: false, partnerIsRandom: false,
  result: null, createdAt: '2026-10-15T00:00:00Z', creatorVote: null, partnerVote: null
}
const fullSession = { ...waitingSession, partnerId: 'bob', partnerUsername: 'bob', status: 'both_joined' }
const payload = (uid) => ({ uid, kind: 'movie', watchlist: [], watched: [], expireAt: new Date(), createdAt: new Date() })

async function seed(fn) {
  await env.withSecurityRulesDisabled(async ctx => fn(ctx.firestore()))
}

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-cinematrack', firestore: { rules } })
})
afterAll(async () => { await env.cleanup() })
beforeEach(async () => { await env.clearFirestore() })

describe('personal lists', () => {
  it('lets a verified owner read and write their own lists', async () => {
    const db = as.alice()
    await assertSucceeds(setDoc(doc(db, 'watchlists/alice/movies/1'), { title: 'Heat' }))
    await assertSucceeds(getDoc(doc(db, 'watchlists/alice/movies/1')))
    await assertSucceeds(setDoc(doc(db, 'watchlists/alice/watchlog/x'), { notes: 'private note' }))
    await assertSucceeds(getDocs(collection(db, 'watchlists/alice/showlog')))
  })

  it("denies another verified user, for reads, writes and listing", async () => {
    await seed(db => setDoc(doc(db, 'watchlists/alice/watchlog/x'), { notes: 'private note' }))
    const db = as.bob()
    await assertFails(getDoc(doc(db, 'watchlists/alice/watchlog/x')))
    await assertFails(getDocs(collection(db, 'watchlists/alice/watchlog')))
    await assertFails(setDoc(doc(db, 'watchlists/alice/movies/1'), { title: 'Injected' }))
    await assertFails(deleteDoc(doc(db, 'watchlists/alice/watchlog/x')))
  })

  it('denies signed-out users', async () => {
    await seed(db => setDoc(doc(db, 'watchlists/alice/movies/1'), { title: 'Heat' }))
    await assertFails(getDoc(doc(as.anon(), 'watchlists/alice/movies/1')))
  })

  it('denies a user whose e-mail is not verified, even on their own data', async () => {
    await assertFails(setDoc(doc(as.eve(), 'watchlists/eve/movies/1'), { title: 'Heat' }))
    await seed(db => setDoc(doc(db, 'watchlists/eve/movies/1'), { title: 'Heat' }))
    await assertFails(getDoc(doc(as.eve(), 'watchlists/eve/movies/1')))
  })

  it('denies unknown sub-collections', async () => {
    await assertFails(setDoc(doc(as.alice(), 'watchlists/alice/secrets/1'), { a: 1 }))
  })
})

describe('everything else is denied', () => {
  it.each(['users/alice', 'toAdd/1', 'usernames/alice', 'config/app'])('%s', async path => {
    await assertFails(getDoc(doc(as.alice(), path)))
    await assertFails(setDoc(doc(as.alice(), path), { uid: 'alice' }))
  })
})

describe('watch together sessions', () => {
  it('lets a verified user create a session as the creator, with no partner', async () => {
    await assertSucceeds(setDoc(doc(as.alice(), 'sessions/ABC123'), waitingSession))
  })

  it('denies creating a session in someone else\'s name, with a partner, or with a bad code', async () => {
    await assertFails(setDoc(doc(as.mallory(), 'sessions/ABC123'), waitingSession))
    await assertFails(setDoc(doc(as.alice(), 'sessions/ABC123'), { ...waitingSession, partnerId: 'bob' }))
    await assertFails(setDoc(doc(as.alice(), 'sessions/abc'), waitingSession))
    await assertFails(setDoc(doc(as.eve(), 'sessions/ZZZ999'), { ...waitingSession, creatorId: 'eve' }))
  })

  it('lets any verified user read a session by its code (needed to join), but not signed-out users', async () => {
    await seed(db => setDoc(doc(db, 'sessions/ABC123'), waitingSession))
    await assertSucceeds(getDoc(doc(as.mallory(), 'sessions/ABC123')))
    await assertFails(getDoc(doc(as.anon(), 'sessions/ABC123')))
    await assertFails(getDoc(doc(as.eve(), 'sessions/ABC123')))
  })

  it('only lists sessions the user is a member of', async () => {
    await seed(db => setDoc(doc(db, 'sessions/ABC123'), fullSession))
    await assertSucceeds(getDocs(query(collection(as.alice(), 'sessions'), where('creatorId', '==', 'alice'))))
    await assertSucceeds(getDocs(query(collection(as.bob(), 'sessions'), where('partnerId', '==', 'bob'))))
    await assertFails(getDocs(query(collection(as.mallory(), 'sessions'), where('creatorId', '==', 'alice'))))
    await assertFails(getDocs(collection(as.mallory(), 'sessions')))
  })

  it('lets a stranger take the free partner seat for themselves, changing only the seat fields', async () => {
    await seed(db => setDoc(doc(db, 'sessions/ABC123'), waitingSession))
    await assertSucceeds(updateDoc(doc(as.bob(), 'sessions/ABC123'),
      { partnerId: 'bob', partnerUsername: 'bob', status: 'both_joined' }))
  })

  it('denies taking the seat for someone else, or smuggling other changes in', async () => {
    await seed(db => setDoc(doc(db, 'sessions/ABC123'), waitingSession))
    await assertFails(updateDoc(doc(as.mallory(), 'sessions/ABC123'),
      { partnerId: 'bob', partnerUsername: 'bob', status: 'both_joined' }))
    await assertFails(updateDoc(doc(as.bob(), 'sessions/ABC123'),
      { partnerId: 'bob', partnerUsername: 'bob', status: 'both_joined', creatorPreference: 'rigged' }))
    await assertFails(updateDoc(doc(as.bob(), 'sessions/ABC123'), { status: 'resolved' }))
  })

  it('denies stealing a seat that is already taken', async () => {
    await seed(db => setDoc(doc(db, 'sessions/ABC123'), fullSession))
    await assertFails(updateDoc(doc(as.mallory(), 'sessions/ABC123'),
      { partnerId: 'mallory', partnerUsername: 'mallory' }))
  })

  it('lets both members update the session but not reassign the seat or the creator', async () => {
    await seed(db => setDoc(doc(db, 'sessions/ABC123'), fullSession))
    await assertSucceeds(updateDoc(doc(as.alice(), 'sessions/ABC123'), { creatorPreference: 'horror' }))
    await assertSucceeds(updateDoc(doc(as.bob(), 'sessions/ABC123'), { partnerPreference: 'comedy' }))
    await assertFails(updateDoc(doc(as.bob(), 'sessions/ABC123'), { partnerId: 'mallory' }))
    await assertFails(updateDoc(doc(as.alice(), 'sessions/ABC123'), { creatorId: 'mallory' }))
  })

  it('denies outsiders updating or deleting; lets members delete', async () => {
    await seed(db => setDoc(doc(db, 'sessions/ABC123'), fullSession))
    await assertFails(updateDoc(doc(as.mallory(), 'sessions/ABC123'), { status: 'resolved' }))
    await assertFails(deleteDoc(doc(as.mallory(), 'sessions/ABC123')))
    await assertSucceeds(deleteDoc(doc(as.bob(), 'sessions/ABC123')))
  })
})

describe('watch together payloads', () => {
  beforeEach(async () => { await seed(db => setDoc(doc(db, 'sessions/ABC123'), fullSession)) })

  it('lets each member write their own summary and read the other\'s', async () => {
    await assertSucceeds(setDoc(doc(as.alice(), 'sessions/ABC123/payload/alice'), payload('alice')))
    await assertSucceeds(setDoc(doc(as.bob(), 'sessions/ABC123/payload/bob'), payload('bob')))
    await assertSucceeds(getDoc(doc(as.bob(), 'sessions/ABC123/payload/alice')))
    await assertSucceeds(getDoc(doc(as.alice(), 'sessions/ABC123/payload/bob')))
  })

  it('denies writing someone else\'s summary, or one claiming another uid', async () => {
    await assertFails(setDoc(doc(as.bob(), 'sessions/ABC123/payload/alice'), payload('alice')))
    await assertFails(setDoc(doc(as.alice(), 'sessions/ABC123/payload/alice'), payload('bob')))
  })

  it('denies outsiders reading or writing', async () => {
    await seed(db => setDoc(doc(db, 'sessions/ABC123/payload/alice'), payload('alice')))
    await assertFails(getDoc(doc(as.mallory(), 'sessions/ABC123/payload/alice')))
    await assertFails(setDoc(doc(as.mallory(), 'sessions/ABC123/payload/mallory'), payload('mallory')))
  })

  it('denies oversized or unexpected payloads', async () => {
    const big = Array.from({ length: 301 }, (_, i) => ({ title: `m${i}` }))
    await assertFails(setDoc(doc(as.alice(), 'sessions/ABC123/payload/alice'), { ...payload('alice'), watchlist: big }))
    await assertFails(setDoc(doc(as.alice(), 'sessions/ABC123/payload/alice'), { ...payload('alice'), notes: 'extra field' }))
  })

  it('lets either member delete both summaries when the session ends, but not outsiders', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'sessions/ABC123/payload/alice'), payload('alice'))
      await setDoc(doc(db, 'sessions/ABC123/payload/bob'), payload('bob'))
    })
    await assertFails(deleteDoc(doc(as.mallory(), 'sessions/ABC123/payload/alice')))
    await assertSucceeds(deleteDoc(doc(as.bob(), 'sessions/ABC123/payload/alice')))
    await assertSucceeds(deleteDoc(doc(as.bob(), 'sessions/ABC123/payload/bob')))
  })

  it('lets the owner delete their summary even after the session is gone', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'sessions/ABC123/payload/alice'), payload('alice'))
      await deleteDoc(doc(db, 'sessions/ABC123'))
    })
    await assertSucceeds(deleteDoc(doc(as.alice(), 'sessions/ABC123/payload/alice')))
  })
})
