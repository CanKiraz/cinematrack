import { describe, expect, it } from 'vitest'
import { DEFAULT_LIMITS, cleanup, consume, loadLimits, periodKey } from '../src/limits'
import { NOW, fakeD1 } from './helpers'

const tight = loadLimits(JSON.stringify({ chat: { perUser: 2, global: 3 } }))

describe('consume', () => {
  it('lets a user use their allowance, then says no', async () => {
    const db = fakeD1()
    expect((await consume(db, 'chat', 'alice', tight, NOW)).ok).toBe(true)
    expect((await consume(db, 'chat', 'alice', tight, NOW)).ok).toBe(true)
    const third = await consume(db, 'chat', 'alice', tight, NOW)
    expect(third).toMatchObject({ ok: false, scope: 'user' })
  })

  it('counts users separately', async () => {
    const db = fakeD1()
    await consume(db, 'chat', 'alice', tight, NOW)
    await consume(db, 'chat', 'alice', tight, NOW)
    expect((await consume(db, 'chat', 'bob', tight, NOW)).ok).toBe(true)
  })

  it('stops everyone once the global allowance is used, without charging the user who was turned away', async () => {
    const db = fakeD1()
    await consume(db, 'chat', 'alice', tight, NOW)
    await consume(db, 'chat', 'bob', tight, NOW)
    await consume(db, 'chat', 'carol', tight, NOW)
    expect(await consume(db, 'chat', 'dave', tight, NOW)).toMatchObject({ ok: false, scope: 'global' })
    // a failed global check must not have used up dave's own allowance
    const row = await db.prepare(`SELECT count FROM usage WHERE key = 'dave'`).first()
    expect(row).toBeNull()
  })

  it('gives the global unit back when only the user limit was hit', async () => {
    const db = fakeD1()
    await consume(db, 'chat', 'alice', tight, NOW)
    await consume(db, 'chat', 'alice', tight, NOW)
    await consume(db, 'chat', 'alice', tight, NOW)   // refused: user limit
    const global = await db.prepare(`SELECT count FROM usage WHERE key = '*'`).first<{ count: number }>()
    expect(global?.count).toBe(2)
  })

  it('release() hands the unit back, once', async () => {
    const db = fakeD1()
    const used = await consume(db, 'chat', 'alice', tight, NOW)
    if (!used.ok) throw new Error('expected ok')
    await used.release()
    await used.release()
    const row = await db.prepare(`SELECT count FROM usage WHERE key = 'alice'`).first<{ count: number }>()
    expect(row?.count).toBe(0)
  })

  it('starts fresh on a new day (daily) and a new month (monthly)', async () => {
    const db = fakeD1()
    await consume(db, 'chat', 'alice', tight, NOW)
    await consume(db, 'chat', 'alice', tight, NOW)
    const tomorrow = new Date('2026-10-16T00:00:01Z')
    expect((await consume(db, 'chat', 'alice', tight, tomorrow)).ok).toBe(true)

    const monthly = loadLimits(JSON.stringify({ caption: { perUser: 1, global: 10 } }))
    await consume(db, 'caption', 'alice', monthly, NOW)
    expect((await consume(db, 'caption', 'alice', monthly, new Date('2026-10-30T23:00:00Z'))).ok).toBe(false)
    expect((await consume(db, 'caption', 'alice', monthly, new Date('2026-11-01T00:00:01Z'))).ok).toBe(true)
  })

  it('reports how long until the allowance resets', async () => {
    const db = fakeD1()
    const limits = loadLimits(JSON.stringify({ chat: { perUser: 0, global: 5 } }))
    const r = await consume(db, 'chat', 'alice', limits, NOW)   // 12:00 UTC: 12 hours to midnight
    expect(r).toMatchObject({ ok: false, scope: 'user' })
    expect(r.ok ? 0 : r.retryAfterSeconds).toBe(12 * 3600)
  })
})

describe('loadLimits', () => {
  it('uses the defaults when nothing is set', () => {
    expect(loadLimits()).toEqual(DEFAULT_LIMITS)
  })

  it('merges valid overrides and ignores bad ones', () => {
    const l = loadLimits(JSON.stringify({ chat: { perUser: 5 }, together: { perUser: -1, global: 'x' }, nonsense: 1 }))
    expect(l.chat).toEqual({ ...DEFAULT_LIMITS.chat, perUser: 5 })
    expect(l.together).toEqual(DEFAULT_LIMITS.together)
  })

  it('survives broken JSON', () => {
    expect(loadLimits('{oops')).toEqual(DEFAULT_LIMITS)
  })

  it('ships with the Instagram quota under the RapidAPI free plan (100 a month)', () => {
    expect(DEFAULT_LIMITS.caption.global).toBeLessThan(100)
    expect(DEFAULT_LIMITS.caption.period).toBe('month')
  })
})

describe('periodKey', () => {
  it('is the UTC day or month', () => {
    expect(periodKey('day', NOW)).toBe('2026-10-15')
    expect(periodKey('month', NOW)).toBe('2026-10')
  })
})

describe('cleanup', () => {
  it('drops old counters and captions, keeps recent ones', async () => {
    const db = fakeD1()
    await db.prepare(`INSERT INTO usage VALUES ('chat','a','2026-01-01',3), ('chat','a','2026-10-14',3), ('caption','a','2025-01',1), ('caption','a','2026-10',1)`).run()
    await db.prepare(`INSERT INTO caption_cache VALUES ('old','x',1), ('new','y',?)`).bind(Math.floor(NOW.getTime() / 1000)).run()
    await cleanup(db, NOW)
    const periods = (await db.prepare(`SELECT period FROM usage ORDER BY period`).all<{ period: string }>()).results.map(r => r.period)
    expect(periods).toEqual(['2026-10', '2026-10-14'])
    const codes = (await db.prepare(`SELECT code FROM caption_cache`).all<{ code: string }>()).results.map(r => r.code)
    expect(codes).toEqual(['new'])
  })
})
