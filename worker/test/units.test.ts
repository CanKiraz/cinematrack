import { describe, expect, it } from 'vitest'
import { generateKeyPair } from 'jose'
import { AuthError, authenticate } from '../src/auth'
import { buildTmdbUrl } from '../src/tmdb'
import { cleanText, parseItems, parseName } from '../src/validate'
import {
  chatPrompt, formatList, mapSource, parseTitles, parseTogetherAnswer, togetherPrompt, type TogetherUser
} from '../src/prompts'
import { shortcode } from '../src/instagram'
import { PROJECT, makeAuth } from './helpers'

const request = (token?: string) =>
  new Request('https://api.test/v1/x', { headers: token ? { Authorization: `Bearer ${token}` } : {} })

describe('authenticate', () => {
  it('accepts a good token', async () => {
    const { keys, token } = await makeAuth()
    await expect(authenticate(request(await token({ uid: 'u9' })), PROJECT, keys)).resolves.toMatchObject({ uid: 'u9' })
  })

  it('needs a token', async () => {
    const { keys } = await makeAuth()
    await expect(authenticate(request(), PROJECT, keys)).rejects.toMatchObject({ code: 'missing_token' })
  })

  it('refuses tokens from another Firebase project', async () => {
    const { keys, token } = await makeAuth()
    await expect(authenticate(request(await token({ project: 'someone-elses-app' })), PROJECT, keys))
      .rejects.toMatchObject({ code: 'invalid_token' })
  })

  it('refuses expired tokens', async () => {
    const { keys, token } = await makeAuth()
    await expect(authenticate(request(await token({ expiresIn: '-1m' })), PROJECT, keys))
      .rejects.toMatchObject({ code: 'invalid_token' })
  })

  it('refuses tokens signed with someone else\'s key', async () => {
    const { keys, token } = await makeAuth()
    const other = await generateKeyPair('RS256')
    await expect(authenticate(request(await token({ key: other.privateKey })), PROJECT, keys))
      .rejects.toMatchObject({ code: 'invalid_token' })
  })

  it('refuses accounts whose email is not verified', async () => {
    const { keys, token } = await makeAuth()
    await expect(authenticate(request(await token({ verified: false })), PROJECT, keys))
      .rejects.toMatchObject({ code: 'email_not_verified' })
  })

  it('refuses garbage', async () => {
    const { keys } = await makeAuth()
    await expect(authenticate(request('not.a.jwt'), PROJECT, keys)).rejects.toBeInstanceOf(AuthError)
  })
})

describe('buildTmdbUrl', () => {
  const params = (s: string) => new URLSearchParams(s)

  it('allows the calls the apps make, and adds the key itself', () => {
    const u = buildTmdbUrl('search/movie', params('query=heat&language=tr-TR'), 'KEY')!
    expect(u.origin + u.pathname).toBe('https://api.themoviedb.org/3/search/movie')
    expect(u.searchParams.get('api_key')).toBe('KEY')
    expect(u.searchParams.get('include_adult')).toBe('false')
    expect(buildTmdbUrl('tv/1396', params('language=en-US&append_to_response=translations'), 'K')).not.toBeNull()
    expect(buildTmdbUrl('movie/603/watch/providers', params(''), 'K')).not.toBeNull()
    expect(buildTmdbUrl('search/multi', params('query=x&page=2'), 'K')).not.toBeNull()
  })

  it('refuses everything else', () => {
    for (const path of ['account', 'movie/603/credits', 'person/1', 'search/person', 'movie/abc', '../account', 'movie/603/watch/providers/x', '']) {
      expect(buildTmdbUrl(path, params(''), 'K'), path).toBeNull()
    }
  })

  it('refuses unexpected parameters, including a caller-supplied api_key', () => {
    expect(buildTmdbUrl('search/movie', params('query=x&api_key=mine'), 'K')).toBeNull()
    expect(buildTmdbUrl('search/movie', params('query=x&include_adult=true'), 'K')).toBeNull()
    expect(buildTmdbUrl('movie/1', params('append_to_response=credits'), 'K')).toBeNull()
    expect(buildTmdbUrl('search/movie', params('language=turkish'), 'K')).toBeNull()
  })
})

describe('validation', () => {
  it('cleanText removes control characters and angle brackets and caps the length', () => {
    expect(cleanText('a\nb\u0000<script>c', 100)).toBe('a b script c')
    expect(cleanText('x'.repeat(50), 10)).toHaveLength(10)
    expect(cleanText(42, 10)).toBe('')
  })

  it('parseName keeps only safe characters', () => {
    expect(parseName('al</ex>_1.-')).toBe('alex_1.-')
    expect(parseName('Çağlar')).toBe('Çağlar')
    expect(parseName('<>')).toBe('User')
    expect(parseName('x'.repeat(40))).toHaveLength(20)
  })

  it('parseItems cleans entries and drops junk', () => {
    const items = parseItems([
      { title: 'Heat', genres: ['Crime', 'Drama', 'Thriller', 'Extra'], vote_average: 8.2, release_date: '1995-12-15', rating: 9 },
      { title: '' }, 'nope', null, { title: 'Bad', vote_average: 99 }
    ], 10)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ title: 'Heat', genres: ['Crime', 'Drama', 'Thriller'], voteAverage: 8.2, year: '1995', rating: 9 })
    expect(items[1]).toMatchObject({ title: 'Bad', voteAverage: null })
  })

  it('parseItems caps the list length', () => {
    expect(parseItems(Array.from({ length: 50 }, (_, i) => ({ title: `t${i}` })), 10)).toHaveLength(10)
  })
})

describe('prompts', () => {
  const user = (name: string, random: boolean, prompt = ''): TogetherUser => ({
    name, random, prompt,
    watched: parseItems([{ title: `${name} saw this`, genres: ['Drama'], vote_average: 7.5, release_date: '2001-01-01' }], 5),
    watchlist: parseItems([{ title: `${name} wants this` }], 5)
  })

  it('formats lists like the apps always did', () => {
    expect(formatList([])).toBe('Empty')
    expect(formatList(parseItems([{ title: 'Heat', genres: ['Crime', 'Drama'], vote_average: 8.2, release_date: '1995-12-15' }], 1)))
      .toBe('- Heat (Crime, Drama) ★8.2 [1995]')
  })

  it('builds the Watch Together prompt from both people\'s data', () => {
    const p = togetherPrompt({ kind: 'movie', language: 'en', users: [user('alex', true), user('sam', false, 'a 90s thriller')] })
    expect(p).toContain('two users (alex and sam)')
    expect(p).toContain('<alex_DATA>')
    expect(p).toContain('Choice: Random')
    expect(p).toContain('Choice: Prompt: a 90s thriller')
    expect(p).toContain('- sam wants this')
    expect(p).toContain('Both Watchlists | alex Watchlist | sam Watchlist | Gemini Recommendation')
    expect(p).toContain('"title": "Movie Title"')
    expect(p).toContain('Write the "reasoning" text in English.')
  })

  it('talks about TV series for series sessions and asks for Turkish when needed', () => {
    const p = togetherPrompt({ kind: 'tv', language: 'tr', users: [user('alex', true), user('sam', true)] })
    expect(p).toContain('*single TV series*')
    expect(p).toContain('"title": "Series Title"')
    expect(p).not.toMatch(/\bmovies?\b/i)   // "recommended_movie" is one word with an underscore, so it does not count
    expect(p).toContain('Write the "reasoning" text in Turkish.')
    expect(p).toContain('"recommended_movie"')   // the JSON key never changes
  })

  it('builds the chat prompt with context', () => {
    const p = chatPrompt({
      kind: 'movie', language: 'tr',
      messages: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'hello' }, { role: 'user', text: 'something scary?' }],
      watchlist: parseItems([{ title: 'Alien' }], 5),
      stats: { totalWatched: 12, favoriteGenre: 'Horror', avgRating: 7.25 },
      recent: parseItems([{ title: 'Heat', rating: 9, watched_at: '2026-10-01' }], 5)
    })
    expect(p).toContain('You are CinemaTrack AI')
    expect(p).toContain('Always answer in Turkish.')
    expect(p).toContain("User's current watchlist:\n- Alien (Unknown)")
    expect(p).toContain('12 movies watched total, favorite genre: Horror, average rating: 7.3')
    expect(p).toContain('- Heat — 2026-10-01, rated 9/10')
    expect(p.endsWith('User: something scary?\nAssistant:')).toBe(true)
  })

  it('says so when the watchlist is empty', () => {
    const p = chatPrompt({ kind: 'tv', language: 'en', messages: [{ role: 'user', text: 'x' }], watchlist: [],
      stats: { totalWatched: null, favoriteGenre: null, avgRating: null }, recent: [] })
    expect(p).toContain('You are DiziTrack AI')
    expect(p).toContain('User has no TV series in their watchlist yet.')
  })
})

describe('reading the answers', () => {
  const answer = (source: string, extra = '') => `Sure!\n\`\`\`json\n{"recommended_movie":{"title":"Heat","year":"1995","genre":"Crime","reasoning":"You both like crime.","source":"${source}"${extra}}}\n\`\`\``

  it('parses a Watch Together pick', () => {
    expect(parseTogetherAnswer(answer('Both Watchlists'), 'alex', 'sam'))
      .toEqual({ title: 'Heat', year: '1995', genre: 'Crime', reasoning: 'You both like crime.', source: 'both' })
  })

  it('maps the source to who it came from, longest name first', () => {
    expect(mapSource('alex Watchlist', 'alex', 'sam')).toBe('first')
    expect(mapSource('sam Watchlist', 'alex', 'sam')).toBe('second')
    expect(mapSource('Gemini Recommendation', 'alex', 'sam')).toBe('gemini')
    expect(mapSource('joann Watchlist', 'ann', 'joann')).toBe('second')
    expect(mapSource('ann Watchlist', 'ann', 'joann')).toBe('first')
  })

  it('gives null for anything that is not the expected JSON', () => {
    expect(parseTogetherAnswer('I cannot decide', 'a', 'b')).toBeNull()
    expect(parseTogetherAnswer('{"recommended_movie":{"year":"1995"}}', 'a', 'b')).toBeNull()
    expect(parseTogetherAnswer('{broken', 'a', 'b')).toBeNull()
  })

  it('parses reel titles: at most 3, no UNKNOWN', () => {
    expect(parseTitles('["A","B","C","D"]')).toEqual(['A', 'B', 'C'])
    expect(parseTitles('Sure: ["Heat", "UNKNOWN"]')).toEqual(['Heat'])
    expect(parseTitles('["UNKNOWN"]')).toEqual([])
    expect(parseTitles('no idea')).toEqual([])
  })

  it('finds the short code in reel links', () => {
    expect(shortcode('https://www.instagram.com/reel/Cx12_ab-9/?igsh=abc')).toBe('Cx12_ab-9')
    expect(shortcode('https://instagram.com/someone/reels/XyZ123/')).toBe('XyZ123')
    expect(shortcode('https://www.instagram.com/p/AbC/')).toBe('AbC')
    expect(shortcode('https://example.com/reel/abc')).toBeNull()
  })
})
