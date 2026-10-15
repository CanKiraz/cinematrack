// The apps may only ask TMDB for the few things they actually need. Anything else is refused, so the shared
// key cannot be used as a general-purpose TMDB proxy.

const BASE = 'https://api.themoviedb.org/3/'

const PATHS: RegExp[] = [
  /^search\/(movie|tv|multi)$/,
  /^(movie|tv)\/[0-9]{1,9}$/,
  /^(movie|tv)\/[0-9]{1,9}\/watch\/providers$/
]

const PARAMS: Record<string, RegExp> = {
  query: /^[\s\S]{1,200}$/,
  language: /^[a-z]{2}-[A-Z]{2}$/,
  page: /^[1-9][0-9]?$/,
  append_to_response: /^translations$/
}

/**
 * `path` is what comes after /v1/tmdb/ (for example "search/movie"). Returns the TMDB URL to call,
 * or null if the request is not on the allow-list.
 */
export function buildTmdbUrl(path: string, params: URLSearchParams, apiKey: string): URL | null {
  if (!PATHS.some(re => re.test(path))) return null

  const url = new URL(path, BASE)
  for (const [name, value] of params) {
    const allowed = PARAMS[name]
    if (!allowed || !allowed.test(value)) return null
    url.searchParams.set(name, value)
  }
  if (path.startsWith('search/')) url.searchParams.set('include_adult', 'false')
  url.searchParams.set('api_key', apiKey)
  return url
}
