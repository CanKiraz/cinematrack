// Usage limits. Every metered call counts against the caller's own allowance AND a global one, so a single
// account cannot use up everybody's share of the free API quotas.

export type Action = 'tmdb' | 'chat' | 'together' | 'titles' | 'caption'

export interface Limit {
  perUser: number
  global: number
  period: 'day' | 'month'
}

export const DEFAULT_LIMITS: Record<Action, Limit> = {
  tmdb:     { perUser: 1000, global: 50000, period: 'day' },
  chat:     { perUser: 30,   global: 1000,  period: 'day' },    // AI Chat messages
  together: { perUser: 10,   global: 300,   period: 'day' },    // Watch Together picks
  titles:   { perUser: 20,   global: 300,   period: 'day' },    // "what is this reel about?" (Gemini)
  caption:  { perUser: 3,    global: 80,    period: 'month' }    // RapidAPI: the free plan is 100 requests a month
}

/** DEFAULT_LIMITS with the (optional) LIMITS variable merged over it. Bad entries are ignored. */
export function loadLimits(raw?: string): Record<Action, Limit> {
  const limits = structuredClone(DEFAULT_LIMITS)
  if (!raw) return limits
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return limits }
  if (!parsed || typeof parsed !== 'object') return limits
  for (const action of Object.keys(limits) as Action[]) {
    const o = (parsed as Record<string, unknown>)[action]
    if (!o || typeof o !== 'object') continue
    const { perUser, global } = o as Record<string, unknown>
    if (Number.isInteger(perUser) && (perUser as number) >= 0) limits[action].perUser = perUser as number
    if (Number.isInteger(global) && (global as number) >= 0) limits[action].global = global as number
  }
  return limits
}

/** 'YYYY-MM-DD' for daily limits, 'YYYY-MM' for monthly ones (UTC). */
export function periodKey(period: Limit['period'], now: Date): string {
  const iso = now.toISOString()
  return period === 'day' ? iso.slice(0, 10) : iso.slice(0, 7)
}

/** When the allowance resets, as an ISO date: used for the Retry-After header. */
export function periodEnd(period: Limit['period'], now: Date): Date {
  return period === 'day'
    ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
}

export type Consumption =
  | { ok: true; release: () => Promise<void> }
  | { ok: false; scope: 'user' | 'global'; retryAfterSeconds: number }

// Increment only while below the limit; the row comes back only if the increment happened.
const TAKE = `INSERT INTO usage (scope, key, period, count) VALUES (?, ?, ?, 1)
              ON CONFLICT (scope, key, period) DO UPDATE SET count = count + 1 WHERE count < ?
              RETURNING count`
const GIVE_BACK = `UPDATE usage SET count = count - 1 WHERE scope = ? AND key = ? AND period = ? AND count > 0`

async function take(db: D1Database, action: Action, key: string, period: string, max: number): Promise<boolean> {
  if (max <= 0) return false
  const row = await db.prepare(TAKE).bind(action, key, period, max).first<{ count: number }>()
  return row !== null
}

async function giveBack(db: D1Database, action: Action, key: string, period: string): Promise<void> {
  await db.prepare(GIVE_BACK).bind(action, key, period).run()
}

/**
 * Try to use one unit of `action` for user `uid`. On success the returned `release()` hands the unit back:
 * call it when the upstream service failed, so people are not charged for errors.
 */
export async function consume(
  db: D1Database, action: Action, uid: string, limits: Record<Action, Limit>, now: Date
): Promise<Consumption> {
  const limit = limits[action]
  const period = periodKey(limit.period, now)
  const retryAfterSeconds = Math.max(1, Math.ceil((periodEnd(limit.period, now).getTime() - now.getTime()) / 1000))

  if (!(await take(db, action, '*', period, limit.global))) return { ok: false, scope: 'global', retryAfterSeconds }
  if (!(await take(db, action, uid, period, limit.perUser))) {
    await giveBack(db, action, '*', period)
    return { ok: false, scope: 'user', retryAfterSeconds }
  }
  let released = false
  return {
    ok: true,
    release: async () => {
      if (released) return
      released = true
      await giveBack(db, action, '*', period)
      await giveBack(db, action, uid, period)
    }
  }
}

/** Daily housekeeping: forget old counters and cached captions. */
export async function cleanup(db: D1Database, now: Date): Promise<void> {
  const keepDaysBack = new Date(now.getTime() - 40 * 24 * 3600 * 1000).toISOString().slice(0, 10)
  const keepMonthsBack = new Date(now.getTime() - 400 * 24 * 3600 * 1000).toISOString().slice(0, 7)
  // 'YYYY-MM' sorts before 'YYYY-MM-DD' of the same month, so each kind is compared on its own length
  await db.prepare(`DELETE FROM usage WHERE length(period) = 10 AND period < ?`).bind(keepDaysBack).run()
  await db.prepare(`DELETE FROM usage WHERE length(period) = 7 AND period < ?`).bind(keepMonthsBack).run()
  await db.prepare(`DELETE FROM caption_cache WHERE created_at < ?`)
    .bind(Math.floor(now.getTime() / 1000) - 180 * 24 * 3600).run()
}
