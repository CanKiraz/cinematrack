import type { Deps, Env } from './env'
import { AuthError, authenticate, type AuthUser } from './auth'
import { cleanup, consume, loadLimits, type Action, type Limit } from './limits'
import { buildTmdbUrl } from './tmdb'
import { generate, UpstreamError } from './gemini'
import { fetchCaption, shortcode } from './instagram'
import {
  chatPrompt, parseTitles, parseTogetherAnswer, titlesPrompt, togetherPrompt,
  type ChatInput, type TogetherInput, type TogetherUser
} from './prompts'
import {
  BadRequest, asObject, cleanText, parseItems, parseKind, parseLang, parseName, readJson
} from './validate'

// CinemaTrack API: lets the desktop and Android apps use the shared TMDB / Gemini / RapidAPI keys without ever
// holding them. Every call needs a Firebase ID token of a verified account and counts against usage limits.
//
//   GET  /health                      (open)
//   GET  /v1/tmdb/<path>?<params>     allow-listed TMDB reads
//   POST /v1/ai/chat                  AI Chat
//   POST /v1/ai/together              Watch Together pick
//   POST /v1/ai/titles                "what movie is this reel about?"
//   POST /v1/instagram/caption        reel caption from RapidAPI (fallback, tiny quota, cached)

const defaultDeps: Deps = {
  fetch: (input, init) => fetch(input, init),
  now: () => new Date(),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms))
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env, defaultDeps)
  },
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await cleanup(env.DB, defaultDeps.now())
  }
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers
    }
  })
}

function fail(status: number, error: string, message: string, headers: Record<string, string> = {}): Response {
  return json({ error, message }, status, headers)
}

const POST_ROUTES = ['ai/chat', 'ai/together', 'ai/titles', 'instagram/caption']

function featureOf(route: string): 'tmdb' | 'ai' | 'instagram' {
  return route.startsWith('tmdb') ? 'tmdb' : route.startsWith('instagram') ? 'instagram' : 'ai'
}

export async function handleRequest(request: Request, env: Env, deps: Deps): Promise<Response> {
  const url = new URL(request.url)
  if (url.pathname === '/health') return json({ ok: true })

  if (env.DISABLED === 'true') return fail(503, 'disabled', 'The service is switched off for now.')

  const match = /^\/v1\/(.+)$/.exec(url.pathname)
  if (!match) return fail(404, 'not_found', 'Unknown route.')
  const route = match[1]!

  const disabled = (env.DISABLED_FEATURES ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (disabled.includes(featureOf(route))) return fail(503, 'disabled', 'This feature is switched off for now.')

  try {
    const user = await authenticate(request, env.FIREBASE_PROJECT_ID, deps.keys)
    const limits = loadLimits(env.LIMITS)

    if (route.startsWith('tmdb/')) {
      if (request.method !== 'GET') return fail(405, 'method_not_allowed', 'Use GET.')
      return await tmdb(route.slice('tmdb/'.length), url, env, deps, user, limits)
    }
    if (!POST_ROUTES.includes(route)) return fail(404, 'not_found', 'Unknown route.')
    if (request.method !== 'POST') return fail(405, 'method_not_allowed', 'Use POST.')

    switch (route) {
      case 'ai/chat':           return await aiChat(request, env, deps, user, limits)
      case 'ai/together':       return await aiTogether(request, env, deps, user, limits)
      case 'ai/titles':         return await aiTitles(request, env, deps, user, limits)
      case 'instagram/caption': return await instagramCaption(request, env, deps, user, limits)
      default:                  return fail(404, 'not_found', 'Unknown route.')
    }
  } catch (e) {
    if (e instanceof AuthError) return fail(e.code === 'email_not_verified' ? 403 : 401, e.code, e.message)
    if (e instanceof BadRequest) return fail(400, 'bad_request', e.message)
    if (e instanceof UpstreamError) {
      const busy = e.status === 429 || e.status === 503
      return fail(busy ? 503 : 502, 'upstream_error', busy ? 'The service is busy. Try again in a moment.' : 'The upstream service failed.')
    }
    console.error('unhandled error:', e instanceof Error ? e.message : e)
    return fail(500, 'internal', 'Something went wrong.')
  }
}

/** Tells the caller how many calls of this kind they have left in the current period (so an app can show "7 left today"). */
function withRemaining(res: Response, remaining: number): Response {
  const headers = new Headers(res.headers)
  headers.set('X-RateLimit-Remaining', String(remaining))
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

/** The answer for a call that is over its limit. */
function limited(scope: 'user' | 'global', retryAfterSeconds: number): Response {
  const headers = { 'Retry-After': String(retryAfterSeconds) }
  return scope === 'user'
    ? fail(429, 'rate_limited', 'You have reached your limit for this feature. Try again later.', headers)
    : fail(429, 'quota_exhausted', "Everyone's share of this feature is used up for now. Try again later.", headers)
}

/** Meter one call, run `work`, and hand the unit back if the upstream service failed. */
async function metered(
  action: Action, env: Env, deps: Deps, user: AuthUser, limits: Record<Action, Limit>, work: () => Promise<Response>
): Promise<Response> {
  const used = await consume(env.DB, action, user.uid, limits, deps.now())
  if (!used.ok) return limited(used.scope, used.retryAfterSeconds)
  try {
    return withRemaining(await work(), used.remaining)
  } catch (e) {
    await used.release()
    throw e
  }
}

// ── TMDB ──────────────────────────────────────────────────────────────────────

async function tmdb(path: string, url: URL, env: Env, deps: Deps, user: AuthUser, limits: Record<Action, Limit>): Promise<Response> {
  const upstream = buildTmdbUrl(path, url.searchParams, env.TMDB_KEY)
  if (!upstream) return fail(400, 'bad_request', 'This TMDB request is not allowed.')

  return metered('tmdb', env, deps, user, limits, async () => {
    // TMDB data changes slowly: let Cloudflare cache it (searches briefly, details for hours)
    const ttl = path.startsWith('search/') ? 600 : 21600
    const res = await deps.fetch(upstream.toString(), { cf: { cacheTtl: ttl, cacheEverything: true } })
    if (res.status === 404) return fail(404, 'not_found', 'Not found on TMDB.')
    if (!res.ok) throw new UpstreamError(res.status, `TMDB answered HTTP ${res.status}`)
    return new Response(res.body, {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' }
    })
  })
}

// ── AI ────────────────────────────────────────────────────────────────────────

async function aiChat(request: Request, env: Env, deps: Deps, user: AuthUser, limits: Record<Action, Limit>): Promise<Response> {
  const body = asObject(await readJson(request, 64_000))

  const rawMessages = body['messages']
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) throw new BadRequest('messages must be a non-empty list')
  const messages = rawMessages.slice(-20).map((m): ChatInput['messages'][number] => {
    const o = asObject(m, 'message')
    const role = o['role']
    if (role !== 'user' && role !== 'assistant') throw new BadRequest('message role must be "user" or "assistant"')
    return { role, text: cleanText(o['text'], 2000) }
  })
  if (messages[messages.length - 1]!.role !== 'user' || !messages[messages.length - 1]!.text) {
    throw new BadRequest('the last message must be a non-empty user message')
  }

  const stats = body['stats'] === undefined ? {} : asObject(body['stats'], 'stats')
  const total = stats['total_watched']
  const avg = stats['avg_rating']
  const input: ChatInput = {
    kind: parseKind(body['kind']),
    language: parseLang(body['language']),
    messages,
    watchlist: parseItems(body['watchlist'], 100),
    stats: {
      totalWatched: typeof total === 'number' && Number.isInteger(total) && total >= 0 && total < 1e7 ? total : null,
      favoriteGenre: cleanText(stats['favorite_genre'], 40) || null,
      avgRating: typeof avg === 'number' && Number.isFinite(avg) && avg >= 0 && avg <= 10 ? avg : null
    },
    recent: parseItems(body['recent'], 15)
  }

  return metered('chat', env, deps, user, limits, async () => {
    const text = await generate(deps, env.GEMINI_KEY, env.GEMINI_MODEL || 'gemini-2.5-flash', chatPrompt(input),
      { maxTokens: 2048, temperature: 0.9, thinking: false })
    return json({ text })
  })
}

async function aiTogether(request: Request, env: Env, deps: Deps, user: AuthUser, limits: Record<Action, Limit>): Promise<Response> {
  const body = asObject(await readJson(request, 256_000))

  const rawUsers = body['users']
  if (!Array.isArray(rawUsers) || rawUsers.length !== 2) throw new BadRequest('users must be a list of exactly two')
  const users = rawUsers.map((u): TogetherUser => {
    const o = asObject(u, 'user')
    const random = o['random'] === true
    return {
      name: parseName(o['name']),
      random,
      prompt: random ? '' : cleanText(o['prompt'], 300) || 'anything',
      watched: parseItems(o['watched'], 100),
      watchlist: parseItems(o['watchlist'], 300)
    }
  }) as [TogetherUser, TogetherUser]
  // names are used to tell the two lists apart in the prompt and in the answer, so they must differ
  if (users[0].name.toLowerCase() === users[1].name.toLowerCase()) users[1].name = `${users[1].name}2`

  const input: TogetherInput = { kind: parseKind(body['kind']), language: parseLang(body['language']), users }

  return metered('together', env, deps, user, limits, async () => {
    const raw = await generate(deps, env.GEMINI_KEY, env.GEMINI_MODEL || 'gemini-2.5-flash', togetherPrompt(input),
      { maxTokens: 8192, temperature: 0.4, thinking: true })
    // `source` is "first" / "second" in the order the users were sent (the app knows who is who)
    return json({ pick: parseTogetherAnswer(raw, users[0].name, users[1].name) })
  })
}

async function aiTitles(request: Request, env: Env, deps: Deps, user: AuthUser, limits: Record<Action, Limit>): Promise<Response> {
  const body = asObject(await readJson(request, 16_000))
  const caption = cleanText(body['caption'], 2000)
  if (!caption) throw new BadRequest('caption is required')

  return metered('titles', env, deps, user, limits, async () => {
    const raw = await generate(deps, env.GEMINI_KEY, env.GEMINI_MODEL || 'gemini-2.5-flash', titlesPrompt(caption),
      { maxTokens: 256, temperature: 0.2, thinking: false })
    return json({ titles: parseTitles(raw) })
  })
}

// ── Instagram ─────────────────────────────────────────────────────────────────

async function instagramCaption(request: Request, env: Env, deps: Deps, user: AuthUser, limits: Record<Action, Limit>): Promise<Response> {
  const body = asObject(await readJson(request, 4_000))
  const code = shortcode(cleanText(body['url'], 400))
  if (!code) throw new BadRequest('url must be an Instagram reel or post link')

  const result = await fetchCaption(env, deps, user.uid, code, limits)
  if (result.status === 'limited') {
    return fail(429, 'quota_exhausted', 'The Instagram lookups for this month are used up.',
      { 'Retry-After': String(result.retryAfterSeconds) })
  }
  return json({ caption: result.caption, cached: result.cached }, 200,
    result.remaining === undefined ? {} : { 'X-RateLimit-Remaining': String(result.remaining) })
}
