import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'

// Firebase signs its ID tokens with Google's rotating "securetoken" keys.
const JWKS_URL = new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
let remoteKeys: JWTVerifyGetKey | undefined

export interface AuthUser {
  uid: string
  email: string
}

export type AuthFailure = 'missing_token' | 'invalid_token' | 'email_not_verified'

export class AuthError extends Error {
  constructor(public code: AuthFailure, message: string) {
    super(message)
  }
}

/**
 * Check the `Authorization: Bearer <Firebase ID token>` header. The token must be signed by Google, issued by
 * OUR Firebase project, unexpired, and belong to an account whose email is verified.
 */
export async function authenticate(request: Request, projectId: string, keys?: JWTVerifyGetKey): Promise<AuthUser> {
  const header = request.headers.get('Authorization') ?? ''
  const match = /^Bearer\s+(\S+)$/i.exec(header)
  if (!match) throw new AuthError('missing_token', 'Send your Firebase ID token as "Authorization: Bearer <token>".')

  let payload
  try {
    const key = keys ?? (remoteKeys ??= createRemoteJWKSet(JWKS_URL))
    ;({ payload } = await jwtVerify(match[1]!, key, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      algorithms: ['RS256']
    }))
  } catch {
    throw new AuthError('invalid_token', 'The token is invalid or expired.')
  }

  const uid = payload.sub
  if (typeof uid !== 'string' || uid.length === 0 || uid.length > 128) {
    throw new AuthError('invalid_token', 'The token has no user.')
  }
  if (payload['email_verified'] !== true) {
    throw new AuthError('email_not_verified', 'Verify your email address first.')
  }
  return { uid, email: typeof payload['email'] === 'string' ? payload['email'] : '' }
}
