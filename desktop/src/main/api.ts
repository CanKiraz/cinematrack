import { BrowserWindow, net } from 'electron'

// The apps never hold the TMDB / Gemini keys. They call the CinemaTrack API (worker/), proving who they are with the
// user's Firebase ID token. The network calls happen here in the main process, but the token lives in the
// renderer (Firebase signs the user in there), so the renderer pushes it over and we ask it for a fresh one when needed.

const API_URL = (import.meta.env.MAIN_VITE_API_URL || 'https://cinematrack-api.cinematrack-api.workers.dev').replace(/\/$/, '')

/** `message` is "API:<code>": the renderer recognises that prefix and shows a friendly text (see apiError.ts). */
export class ApiError extends Error {
  constructor(public code: string, public status: number) {
    super(`API:${code}`)
  }
}

let idToken: string | null = null
const waiting: (() => void)[] = []

export function setAuthToken(token: string | null): void {
  idToken = token
  waiting.splice(0).forEach(done => done())
}

function expiresSoon(token: string): boolean {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { exp?: number }
    return typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now() + 60_000
  } catch { return true }
}

/** Ask the window for a fresh token and wait (briefly) for it to arrive. */
function askRendererForToken(): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(finish, 8000)
    function finish(): void { clearTimeout(timer); resolve() }
    waiting.push(finish)
    BrowserWindow.getAllWindows()[0]?.webContents.send('auth:refresh-request')
  })
}

async function currentToken(): Promise<string> {
  if (!idToken || expiresSoon(idToken)) await askRendererForToken()
  if (!idToken) throw new ApiError('sign_in_required', 401)
  return idToken
}

export async function api(path: string, options: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    const token = await currentToken()
    const res = await net.fetch(`${API_URL}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {})
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined
    })
    if (res.ok) return res.json()

    let code = 'upstream_error'
    try { code = ((await res.json()) as { error?: string }).error ?? code } catch { /* not JSON */ }
    // The token expired between our check and the call: forget it, get a fresh one, try once more
    if (res.status === 401 && code === 'invalid_token' && attempt === 1) { idToken = null; continue }
    throw new ApiError(code, res.status)
  }
}
