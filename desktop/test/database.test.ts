import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The real src/main/database.ts, on a real SQLite file in a throw-away folder (node:sqlite, no Electron needed).

let dir: string
let db: typeof import('../src/main/database')

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cinematrack-db-'))
  process.env.CT_TEST_DIR = dir
  vi.resetModules()                       // the module reads the data folder when it loads
  db = await import('../src/main/database')
  db.initDatabase()
})

afterEach(() => {
  db.closeDatabase()                      // Windows will not delete a database file that is still open
  rmSync(dir, { recursive: true, force: true })
})

const movie = (id: number, title: string) => ({
  tmdb_id: id, title, overview: 'o', poster_path: null, release_date: '1995-12-15',
  genres: '["Crime"]', vote_average: 8.2, runtime: 170, title_tr: null, overview_tr: null
})
const backups = () => readdirSync(dir).filter(n => n.endsWith('.bak'))

describe('movies, watchlist and watch log', () => {
  it('upserts by TMDB id and keeps the row id', () => {
    const id = db.upsertMovie(movie(949, 'Heat'))
    expect(id).toBeGreaterThan(0)
    expect(db.upsertMovie({ ...movie(949, 'Heat (updated)'), title_tr: 'Sıcak Takip' })).toBe(id)
    db.addToWatchlist(id)
    expect(db.isInWatchlist(949)).toBe(true)
    expect(db.getWatchlist()).toHaveLength(1)
    expect(db.getWatchlist()[0]?.title).toBe('Heat (updated)')
  })

  it('logs watches with a rating and notes, and counts them in the stats', () => {
    const id = db.upsertMovie(movie(949, 'Heat'))
    db.addWatchLog(id, '2026-10-01T20:00:00Z', 9, 'great', null)
    expect(db.isWatched(949)).toBe(true)
    const [entry] = db.getWatchLog()
    expect(entry).toMatchObject({ rating: 9, notes: 'great' })
    const stats = db.getStats()
    expect(stats.total_watched).toBe(1)
    expect(stats.avg_rating).toBe(9)
  })

  it('adds a remote log entry once, adopts a matching local one, and rolls back on failure', () => {
    const added = db.addRemoteWatchLog('doc-1', movie(603, 'The Matrix'), '2026-10-02T20:00:00Z', null, null)
    const again = db.addRemoteWatchLog('doc-1', movie(603, 'The Matrix'), '2026-10-02T20:00:00Z', null, null)
    expect([added, again]).toEqual([true, false])

    const id = db.upsertMovie(movie(949, 'Heat'))
    db.addWatchLog(id, '2026-10-03T20:00:00Z', 7, null, null)               // logged here, before remote ids existed
    expect(db.addRemoteWatchLog('doc-2', movie(949, 'Heat'), '2026-10-03T20:00:00Z', 7, null)).toBe(false)
    expect(db.getWatchLog()).toHaveLength(2)                                  // adopted, not duplicated

    expect(() => db.addRemoteWatchLog('doc-3', { ...movie(11, 'X'), title: null as unknown as string }, '2026-10-04T20:00:00Z', null, null))
      .toThrow()
    expect(db.getWatchLog().some(l => l.remote_id === 'doc-3')).toBe(false)
  })

  it('stores config values', () => {
    db.setConfig('k', 'v')
    expect(db.getConfig('k')).toBe('v')
    expect(db.getConfig('missing')).toBeNull()
  })
})

describe('local data belongs to one account', () => {
  const addTitles = () => {
    db.addToWatchlist(db.upsertMovie(movie(949, 'Heat')))
    db.addToWatchlist(db.upsertMovie(movie(603, 'The Matrix')))
    db.addWatchLog(db.upsertMovie(movie(949, 'Heat')), '2026-10-01T20:00:00Z', 9, 'a private note', null)
  }

  it('the first account to sign in keeps what is already stored (data from before accounts)', () => {
    addTitles()
    expect(db.claimLocalDataFor('alice')).toEqual({ reset: false })
    expect(db.getWatchlist()).toHaveLength(2)
    expect(backups()).toHaveLength(0)
  })

  it('the same account signing in again changes nothing', () => {
    db.claimLocalDataFor('alice')
    addTitles()
    expect(db.claimLocalDataFor('alice')).toEqual({ reset: false })
    expect(db.getWatchlist()).toHaveLength(2)
  })

  // The bug a tester found: signing out of a full account and into an empty one carried everything over
  it('a different account does NOT inherit the previous account\'s lists, watch log or stats', () => {
    db.claimLocalDataFor('alice')
    addTitles()

    expect(db.claimLocalDataFor('bob')).toEqual({ reset: true })

    expect(db.getWatchlist()).toHaveLength(0)
    expect(db.getWatchLog()).toHaveLength(0)
    expect(db.getStats()).toMatchObject({ total_watched: 0, watchlist_count: 0 })
    expect(db.isInWatchlist(949)).toBe(false)
  })

  it('keeps the previous account\'s data as a backup file instead of destroying it', () => {
    db.claimLocalDataFor('alice')
    addTitles()
    db.claimLocalDataFor('bob')
    expect(backups()).toHaveLength(1)
  })

  it('the new account owns the database from then on, and a third account is told apart too', () => {
    db.claimLocalDataFor('alice')
    addTitles()
    db.claimLocalDataFor('bob')
    db.addToWatchlist(db.upsertMovie(movie(11, 'Bob\'s film')))

    expect(db.claimLocalDataFor('bob')).toEqual({ reset: false })
    expect(db.getWatchlist()).toHaveLength(1)

    expect(db.claimLocalDataFor('alice')).toEqual({ reset: true })           // alice's titles come back from the cloud
    expect(db.getWatchlist()).toHaveLength(0)
  })

  it('keeps only the newest few backups', async () => {
    let user = 'u0'
    db.claimLocalDataFor(user)
    for (let i = 1; i <= 6; i++) {
      db.upsertMovie(movie(i, `Film ${i}`))
      await new Promise(r => setTimeout(r, 5))                               // distinct timestamps in the file names
      user = `u${i}`
      db.claimLocalDataFor(user)
    }
    expect(backups().length).toBeLessThanOrEqual(3)
  })
})
