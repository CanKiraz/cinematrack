// The local database writes times as "2026-10-16 12:00:00" (UTC); the cloud stores ISO strings ("2026-10-16T12:00:00.000Z").
// ISO strings sort correctly as text, which is what lets the phone sort by them.

/** "2026-10-16 12:00:00" -> "2026-10-16T12:00:00.000Z". An ISO string is returned unchanged. */
export function sqliteToIso(value: string): string {
  if (value.includes('T')) return value
  return `${value.replace(' ', 'T')}.000Z`
}

/** The ISO time to store for a title that is being added right now, or the one it already has locally. */
export function addedAtFor(entry: { added_at?: string | null } | undefined): string {
  return entry?.added_at ? sqliteToIso(entry.added_at) : new Date().toISOString()
}
