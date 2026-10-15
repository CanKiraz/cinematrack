import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SignJWT, generateKeyPair, type JWTVerifyGetKey } from 'jose'
import { vi } from 'vitest'
import type { Deps, Env } from '../src/env'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')

const migration = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../migrations/0001_init.sql'), 'utf8')

/** The real migration on a real (in-memory) SQLite, wrapped in the small part of the D1 API the Worker uses. */
export function fakeD1(): D1Database {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(migration)
  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    first: async () => (sqlite.prepare(sql).get(...(args as never[])) as unknown) ?? null,
    run: async () => {
      const r = sqlite.prepare(sql).run(...(args as never[]))
      return { success: true, meta: { changes: Number(r.changes) } }
    },
    all: async () => ({ results: sqlite.prepare(sql).all(...(args as never[])) })
  })
  return { prepare: (sql: string) => statement(sql) } as unknown as D1Database
}

export const PROJECT = 'demo-project'

/** A throw-away signing key, and a way to mint Firebase-shaped ID tokens with it. */
export async function makeAuth() {
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const keys: JWTVerifyGetKey = async () => publicKey

  async function token(opts: {
    uid?: string; verified?: boolean; project?: string; expiresIn?: string; key?: CryptoKey | Uint8Array
  } = {}): Promise<string> {
    const project = opts.project ?? PROJECT
    return new SignJWT({ email: 'someone@example.com', email_verified: opts.verified ?? true })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setSubject(opts.uid ?? 'user-1')
      .setIssuer(`https://securetoken.google.com/${project}`)
      .setAudience(project)
      .setIssuedAt()
      .setExpirationTime(opts.expiresIn ?? '1h')
      .sign((opts.key ?? privateKey) as CryptoKey)
  }
  return { keys, token, privateKey }
}

export function makeEnv(db: D1Database, extra: Partial<Env> = {}): Env {
  return {
    DB: db, FIREBASE_PROJECT_ID: PROJECT,
    TMDB_KEY: 'tmdb-secret', GEMINI_KEY: 'gemini-secret', RAPID_KEY: 'rapid-secret',
    ...extra
  }
}

export const NOW = new Date('2026-10-15T12:00:00Z')

export function makeDeps(routes: (url: URL, init?: RequestInit) => Response | Promise<Response>, keys?: JWTVerifyGetKey) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => routes(new URL(String(input)), init))
  const deps: Deps = { fetch: fetchMock as unknown as typeof fetch, now: () => NOW, sleep: async () => {}, keys }
  return { deps, fetchMock }
}

export const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

export const geminiAnswer = (text: string): Response =>
  jsonResponse({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] })
