// ── Firebase config ───────────────────────────────────────────────────────────
// These values only identify the Firebase project and are public by design; what protects the data is
// firebase/firestore.rules plus the API-key restrictions set in the Google Cloud console.
// The defaults point at the official CinemaTrack backend, so `npm run dev` works out of the box.
// To use your own project (or the local emulator) set the VITE_FIREBASE_* variables in desktop/.env.
const env = import.meta.env

export const FIREBASE_CONFIG = {
  apiKey: env.VITE_FIREBASE_API_KEY ?? 'AIzaSyArPhqdTyzpdCujSavdfZjbyfWrPJYVUlU',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? 'cinematrack-f5ee4.firebaseapp.com',
  projectId: env.VITE_FIREBASE_PROJECT_ID ?? 'cinematrack-f5ee4',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? 'cinematrack-f5ee4.firebasestorage.app',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '952567987773',
  appId: env.VITE_FIREBASE_APP_ID ?? '1:952567987773:web:7671ab12a1bc425b46f454'
}
