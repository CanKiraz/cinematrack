import { describe, expect, it } from 'vitest'
import { addedAtFor, sqliteToIso } from '../src/renderer/src/services/dates'

describe('dates shared between the local database and the cloud', () => {
  it('turns a local time into an ISO time', () => {
    expect(sqliteToIso('2026-10-16 12:00:00')).toBe('2026-10-16T12:00:00.000Z')
  })

  it('leaves an ISO time alone', () => {
    expect(sqliteToIso('2026-10-16T12:00:00.123Z')).toBe('2026-10-16T12:00:00.123Z')
  })

  it('ISO times sort correctly as text (the phone relies on that)', () => {
    const times = ['2026-10-16 12:00:00', '2025-01-02 03:04:05', '2026-10-16 09:30:00'].map(sqliteToIso)
    expect([...times].sort()).toEqual(['2025-01-02T03:04:05.000Z', '2026-10-16T09:30:00.000Z', '2026-10-16T12:00:00.000Z'])
  })

  it('keeps the time a title already has locally, and uses now for a new one', () => {
    expect(addedAtFor({ added_at: '2026-10-01 08:00:00' })).toBe('2026-10-01T08:00:00.000Z')
    const now = Date.now()
    const fresh = Date.parse(addedAtFor(undefined))
    expect(Math.abs(fresh - now)).toBeLessThan(5000)
    expect(Number.isNaN(Date.parse(addedAtFor({ added_at: null })))).toBe(false)
  })
})
