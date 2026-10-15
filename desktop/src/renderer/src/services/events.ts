// The Firestore listeners in App.tsx update the local SQLite database in the background.
// Pages read SQLite once when they open, so they must be told when it changed underneath them.
const DATA_CHANGED_EVENT = 'cinematrack:data-changed'

export function notifyDataChanged(): void {
  window.dispatchEvent(new Event(DATA_CHANGED_EVENT))
}

export function onDataChanged(cb: () => void): () => void {
  window.addEventListener(DATA_CHANGED_EVENT, cb)
  return () => window.removeEventListener(DATA_CHANGED_EVENT, cb)
}
