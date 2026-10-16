import { collection, getDocs, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { Kind } from '../types'
import { collectionNames } from './sync'
import { sqliteToIso } from './dates'

let started = false

/**
 * Titles added before the cloud kept an `added_at` have none. This computer knows when they were added (its local
 * database has always stored it), so it writes the missing ones to the cloud once: afterwards the phone can sort by
 * date added too. Only documents without the field are touched, so running it again changes nothing.
 */
export async function backfillAddedAt(uid: string): Promise<void> {
  if (started) return
  started = true
  try {
    for (const kind of ['movie', 'tv'] as Kind[]) {
      const [snap, local] = await Promise.all([
        getDocs(collection(db, 'watchlists', uid, collectionNames(kind).list)),
        window.api.getWatchlist(kind)
      ])
      const localById = new Map(local.map(m => [m.tmdb_id, m]))
      for (const d of snap.docs) {
        const data = d.data() as { tmdb_id?: number; added_at?: string }
        if (data.added_at) continue
        const entry = data.tmdb_id !== undefined ? localById.get(data.tmdb_id) : undefined
        if (!entry?.added_at) continue
        await updateDoc(d.ref, { added_at: sqliteToIso(entry.added_at) }).catch(() => { /* removed meanwhile */ })
      }
    }
  } catch (e) {
    console.error('added_at backfill stopped:', e)
    started = false   // try again next start
  }
}
