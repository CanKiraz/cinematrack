// Request bodies come from the apps, which anyone can imitate, so everything is checked and cleaned here.
// Free text ends up inside AI prompts: control characters and angle brackets are removed, lengths are capped.

import { isOffensive, isReserved } from './names'

export class BadRequest extends Error {}

export type Kind = 'movie' | 'tv'
export type Lang = 'tr' | 'en'

export interface Item {
  title: string
  genres: string[]
  voteAverage: number | null
  year: string | null
  rating: number | null
  watchedAt: string | null
}

export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u001f\u007f<>]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

export function asObject(value: unknown, what = 'body'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequest(`${what} must be an object`)
  return value as Record<string, unknown>
}

export function parseKind(value: unknown): Kind {
  if (value === 'movie' || value === 'tv') return value
  throw new BadRequest('kind must be "movie" or "tv"')
}

export function parseLang(value: unknown): Lang {
  if (value === 'tr' || value === 'en') return value
  throw new BadRequest('language must be "tr" or "en"')
}

/**
 * Display names go into prompts as XML-like tags, so only letters, digits and _ . - survive.
 * A name the checker would refuse (or that is reserved) is replaced, so it never reaches a prompt.
 */
export function parseName(value: unknown): string {
  const name = typeof value === 'string' ? value.replace(/[^\p{L}\p{N}_.-]/gu, '').slice(0, 20) : ''
  if (!name || isOffensive(name) || isReserved(name)) return 'User'
  return name
}

function number(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null
}

export function parseItems(value: unknown, max: number): Item[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new BadRequest('expected a list')
  const items: Item[] = []
  for (const raw of value.slice(0, max)) {
    if (!raw || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    const title = cleanText(o['title'], 200)
    if (!title) continue
    const genres = Array.isArray(o['genres'])
      ? o['genres'].map(g => cleanText(g, 40)).filter(Boolean).slice(0, 3)
      : []
    const date = cleanText(o['release_date'], 10)
    items.push({
      title,
      genres,
      voteAverage: number(o['vote_average'], 0, 10),
      year: /^\d{4}/.test(date) ? date.slice(0, 4) : null,
      rating: number(o['rating'], 0, 10),
      watchedAt: cleanText(o['watched_at'], 32) || null
    })
  }
  return items
}

/** Reads a request body as JSON, refusing anything larger than `maxBytes`. */
export async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(request.headers.get('Content-Length') ?? 0)
  if (declared > maxBytes) throw new BadRequest('body too large')
  const text = await request.text()
  if (text.length > maxBytes) throw new BadRequest('body too large')
  try { return JSON.parse(text) } catch { throw new BadRequest('body is not valid JSON') }
}
