import { EmailAuthProvider, deleteUser, reauthenticateWithCredential } from 'firebase/auth'
import { collection, getDocs, limit, query, writeBatch } from 'firebase/firestore'
import { auth, db } from '../firebase'
import { deleteAllSessions } from './together'

// Everything the apps keep online for a person lives under watchlists/{uid}/... plus their Watch Together sessions
const LIST_COLLECTIONS = ['movies', 'shows', 'watchlog', 'showlog', 'meta']

async function deleteCollection(uid: string, name: string): Promise<void> {
  for (;;) {
    const snap = await getDocs(query(collection(db, 'watchlists', uid, name), limit(400)))
    if (snap.empty) return
    const batch = writeBatch(db)
    snap.docs.forEach(d => batch.delete(d.ref))
    await batch.commit()
  }
}

/**
 * Permanently deletes the signed-in person's online data and then the account itself.
 * Firebase wants a fresh sign-in for this, so the password is asked again. The order matters: the data goes first
 * (the security rules need the account to exist), and if anything fails the account is still there to try again.
 * Data stored on this computer is not touched.
 */
export async function deleteMyAccount(password: string): Promise<void> {
  const user = auth.currentUser
  if (!user?.email) throw new Error('Not signed in')

  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password))

  for (const name of LIST_COLLECTIONS) await deleteCollection(user.uid, name)
  await deleteAllSessions(user.uid)
  await deleteUser(user)
}
