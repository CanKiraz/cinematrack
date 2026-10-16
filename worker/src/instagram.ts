import type { Deps, Env } from './env'
import { consume, type Action, type Limit } from './limits'
import { UpstreamError } from './gemini'

const POST_CODE = /instagram\.com\/(?:[^/?#]+\/)?(?:reels?|p|tv)\/([A-Za-z0-9_-]+)/i

/** The short code in a reel / post link, or null if it is not an Instagram post link. */
export function shortcode(url: string): string | null {
  return POST_CODE.exec(url)?.[1] ?? null
}

export type CaptionResult =
  | { status: 'ok'; caption: string; cached: boolean; remaining?: number }   // remaining: only when RapidAPI was asked
  | { status: 'limited'; retryAfterSeconds: number }

/**
 * Caption of a reel, from the shared cache if we have it, otherwise from RapidAPI (the on-device attempt
 * comes first and is free; this is the fallback, and RapidAPI's free plan is only 100 requests a month).
 */
export async function fetchCaption(
  env: Env, deps: Deps, uid: string, code: string, limits: Record<Action, Limit>
): Promise<CaptionResult> {
  const hit = await env.DB.prepare(`SELECT caption FROM caption_cache WHERE code = ?`).bind(code).first<{ caption: string }>()
  if (hit) return { status: 'ok', caption: hit.caption, cached: true }

  const used = await consume(env.DB, 'caption', uid, limits, deps.now())
  if (!used.ok) return { status: 'limited', retryAfterSeconds: used.retryAfterSeconds }

  try {
    const host = env.RAPID_HOST || 'instagram-scraper-api12.p.rapidapi.com'
    const res = await deps.fetch(`https://${host}/api/v1/posts/info?code=${encodeURIComponent(code)}`, {
      headers: { 'x-rapidapi-key': env.RAPID_KEY, 'x-rapidapi-host': host }
    })
    if (!res.ok) throw new UpstreamError(res.status, `RapidAPI answered HTTP ${res.status}`)
    const json = await res.json() as { data?: { caption?: { text?: string } } }
    const caption = (json.data?.caption?.text ?? '').trim().slice(0, 2000)

    if (caption) {
      await env.DB.prepare(`INSERT OR REPLACE INTO caption_cache (code, caption, created_at) VALUES (?, ?, ?)`)
        .bind(code, caption, Math.floor(deps.now().getTime() / 1000)).run()
    }
    return { status: 'ok', caption, cached: false, remaining: used.remaining }
  } catch (e) {
    await used.release()   // the request failed: do not charge anyone for it
    throw e
  }
}
