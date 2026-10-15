type Translate = (en: string, ...args: (string | number)[]) => string

/**
 * The main process reports problems with the CinemaTrack API as an error whose message contains "API:<code>"
 * (see main/api.ts). Returns that code, or null for any other error.
 */
export function apiErrorCode(error: unknown): string | null {
  return /API:([a-z_]+)/.exec(error instanceof Error ? error.message : String(error))?.[1] ?? null
}

/** A friendly text for the codes people can act on, or null for anything else. */
export function apiCodeText(code: string | null | undefined, t: Translate): string | null {
  switch (code) {
    case 'rate_limited':
      return t('You have reached your limit for this feature. Try again later.')
    case 'quota_exhausted':
      return t("Everyone's share of this feature is used up for now. Try again later.")
    case 'sign_in_required':
    case 'missing_token':
    case 'invalid_token':
    case 'email_not_verified':
      return t('Please sign in again.')
    case 'disabled':
      return t('This feature is switched off for now.')
    case 'upstream_error':
      return t('The service is busy. Try again in a moment.')
    default:
      return null
  }
}

export function apiErrorText(error: unknown, t: Translate): string | null {
  return apiCodeText(apiErrorCode(error), t)
}
