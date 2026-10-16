import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  sendEmailVerification,
  sendPasswordResetEmail,
  verifyBeforeUpdateEmail,
  reload,
  onAuthStateChanged,
  User
} from 'firebase/auth'
import { auth } from '../firebase'

// Accounts are e-mail + password. The display name (shown to your Watch Together partner) lives in the
// Firebase profile only; we keep no user directory in Firestore.

// Before real e-mails, accounts were `username@cinematrack.local`. Those people can still sign in by typing
// just their old username, and are asked to switch to a real address (see upgradeLegacyEmail).
const LEGACY_DOMAIN = '@cinematrack.local'

export const MIN_PASSWORD = 8
// Latin letters including Turkish ones (ç ğ ı ö ş ü İ), digits, . _ -  Other scripts are left out on purpose: the word list can only read Latin letters.
export const DISPLAY_NAME_RE = /^[\p{Script=Latin}0-9_.-]{2,20}$/u

export function isLegacyAccount(user: User | null): boolean {
  return !!user?.email?.toLowerCase().endsWith(LEGACY_DOMAIN)
}

function loginEmail(identifier: string): string {
  const v = identifier.trim()
  return v.includes('@') ? v : `${v.toLowerCase()}${LEGACY_DOMAIN}`
}

/** A display name the check refused. `code` is "name/format", "name/blocked" or "name/reserved". */
export class NameError extends Error {
  code: string
  constructor(reason: string) {
    super(`name:${reason}`)
    this.code = `name/${reason}`
  }
}

/**
 * Asks the CinemaTrack API whether the name is acceptable (format, offensive words, reserved names).
 * If the API cannot be reached the name is let through: a check outage must not stop anybody from signing up.
 */
export async function assertNameAllowed(name: string): Promise<void> {
  const trimmed = name.trim()
  if (!DISPLAY_NAME_RE.test(trimmed)) throw new NameError('format')
  const verdict = await window.api.checkName(trimmed)
  if (!verdict.ok) throw new NameError(verdict.reason ?? 'blocked')
}

/** Changes the name shown to Watch Together partners. */
export async function renameAccount(newName: string): Promise<void> {
  const user = auth.currentUser
  if (!user) throw new Error('Not signed in')
  await assertNameAllowed(newName)
  await updateProfile(user, { displayName: newName.trim() })
}

export async function register(email: string, password: string, displayName: string): Promise<User> {
  await assertNameAllowed(displayName)   // before the account exists, so a refused name leaves nothing behind
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password)
  await updateProfile(cred.user, { displayName: displayName.trim() })
  await sendEmailVerification(cred.user)
  return cred.user
}

export async function login(identifier: string, password: string): Promise<User> {
  const cred = await signInWithEmailAndPassword(auth, loginEmail(identifier), password)
  return cred.user
}

export async function logout(): Promise<void> {
  await signOut(auth)
}

export async function resendVerification(): Promise<void> {
  if (auth.currentUser) await sendEmailVerification(auth.currentUser)
}

/** Re-read the account from Firebase and refresh the token, so a just-verified e-mail takes effect. */
export async function refreshUser(): Promise<User | null> {
  const user = auth.currentUser
  if (!user) return null
  await reload(user)
  await user.getIdToken(true)
  return auth.currentUser
}

export async function resetPassword(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim())
}

/** Legacy accounts: send a confirmation link to the real address; the e-mail changes once it is clicked. */
export async function upgradeLegacyEmail(newEmail: string): Promise<void> {
  if (!auth.currentUser) throw new Error('Not signed in')
  await verifyBeforeUpdateEmail(auth.currentUser, newEmail.trim())
}

export function onAuthChange(cb: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, cb)
}

export function currentUser(): User | null {
  return auth.currentUser
}

/** uid of the signed-in account whose e-mail is verified, the only kind allowed to sync to the cloud (else null) */
export function syncUid(): string | null {
  const user = auth.currentUser
  return user?.emailVerified ? user.uid : null
}
