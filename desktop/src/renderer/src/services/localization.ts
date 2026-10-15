import { collection, getDocs, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { Kind, Movie } from '../types'
import { collectionNames } from './sync'

let started = false

/**
 * Titles and overviews are stored in English plus a Turkish copy (title_tr / overview_tr) so the lists can be shown
 * in either language. Entries added before that only have English: fill in the Turkish text once, quietly in the
 * background. `tr_checked` marks entries that were already looked up (even when TMDB has no Turkish text).
 */
export async function backfillTurkish(uid: string): Promise<void> {
  if (started) return
  started = true
  const cache = new Map<string, Movie>()   // the same title can be in the list and in the log

  try {
    for (const kind of ['movie', 'tv'] as Kind[]) {
      const names = collectionNames(kind)
      for (const name of [names.list, names.log]) {
        const snap = await getDocs(collection(db, 'watchlists', uid, name))
        for (const d of snap.docs) {
          const data = d.data()
          if (data.tr_checked === true || !data.tmdb_id) continue
          const key = `${kind}:${data.tmdb_id}`
          let full = cache.get(key)
          if (!full) {
            try { full = await window.api.getMovie(data.tmdb_id as number, kind) } catch { continue }
            cache.set(key, full)
          }
          await updateDoc(d.ref, {
            title_tr: full.title_tr ?? '',
            overview_tr: full.overview_tr ?? '',
            tr_checked: true
          }).catch(() => { /* deleted meanwhile */ })
        }
      }
    }
  } catch (e) {
    console.error('Turkish backfill stopped:', e)
    started = false   // try again next start
  }
}
