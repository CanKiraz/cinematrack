// Display names are shown to a partner in Watch Together and sit inside AI prompts, so they get a basic check.
// This is a courtesy filter, not a guarantee: the name is stored by Firebase Auth and set by the app, and a modified
// app could skip the check. Keeping the list here (not in the apps) means it can be updated without a release.

export type NameVerdict = { ok: true } | { ok: false; reason: 'format' | 'blocked' | 'reserved' }

/** Letters (any language), digits, underscore, dot and dash; 2 to 20 characters. Same rule as the apps. */
const FORMAT = /^[\p{L}\p{N}_.-]{2,20}$/u

// Matched anywhere inside the name. Only terms that do not appear inside ordinary words or names.
const ANYWHERE = [
  // English
  'fuck', 'shit', 'bitch', 'asshole', 'bastard', 'nigger', 'nigga', 'faggot', 'whore', 'pussy', 'rapist', 'hitler', 'pedophile',
  // Turkish
  'orospu', 'oruspu', 'yarrak', 'yarak', 'amcik', 'aminakoy', 'amnakoy', 'aminakod', 'siktir', 'sikeyim', 'sikerim', 'sikik', 'siktim',
  'pezevenk', 'gavat', 'kahpe', 'yavsak', 'surtuk', 'fahise', 'gotveren', 'gotlek', 'tecavuz', 'pedofil'
]

// Matched only as a whole name or a whole part of it (split by . _ -, digits at the edges ignored). These short or
// common stems would catch innocent names otherwise (Scunthorpe, Dickens, Slutsky, Nazife, Hancock, Grape...).
const WHOLE_WORD = [
  'cunt', 'dick', 'cock', 'slut', 'ass', 'rape', 'nazi', 'kkk',
  'amk', 'aq', 'sik', 'bok', 'got', 'ibne', 'pust', 'tasak'
]

// Names that could pass for the people who run the service.
const RESERVED = ['admin', 'administrator', 'root', 'support', 'system', 'moderator', 'staff', 'official', 'cinematrack', 'dizitrack']

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b' }

/** Lower case (Turkish rules), no accents or Turkish dotted/dotless letters, so "ŞİKTİR" and "siktir" are the same. */
function fold(name: string): string {
  return name
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
}

const leet = (s: string): string => s.replace(/[0134578]/g, d => LEET[d] ?? d)
const letters = (s: string): string => s.replace(/[^a-z]/g, '')
/** "fuuuck" and "fuck" look alike: squeeze repeated letters (the lists are squeezed the same way). */
const squeeze = (s: string): string => s.replace(/(.)\1+/g, '$1')
const plain = (s: string): string => letters(leet(fold(s)))
const key = (s: string): string => squeeze(plain(s))

// The squeezed form is only for the long terms. Short whole-word stems must NOT be squeezed ("kkk" would become "k",
// "ass" would become "as" and ordinary names would be refused).
const ANYWHERE_KEYS = ANYWHERE.map(key)
const WHOLE_KEYS = new Set(WHOLE_WORD.map(plain))
const RESERVED_KEYS = new Set(RESERVED.map(key))

/** True if the name is, or contains, something from the lists. Never used to decide the format. */
export function isOffensive(name: string): boolean {
  const whole = key(name)
  if (ANYWHERE_KEYS.some(term => whole.includes(term))) return true

  // whole-word stems: the whole name, or one of its parts
  const parts = fold(name).split(/[._-]+/).filter(Boolean)
  for (const part of [name, ...parts]) {
    const withoutEdgeDigits = letters(fold(part).replace(/^\d+|\d+$/g, ''))   // "amk123" -> amk
    if (WHOLE_KEYS.has(plain(part)) || WHOLE_KEYS.has(withoutEdgeDigits)) return true
  }
  return false
}

export function isReserved(name: string): boolean {
  return RESERVED_KEYS.has(key(name))
}

export function checkDisplayName(raw: unknown): NameVerdict {
  const name = typeof raw === 'string' ? raw.trim() : ''
  if (!FORMAT.test(name)) return { ok: false, reason: 'format' }
  if (isReserved(name)) return { ok: false, reason: 'reserved' }
  if (isOffensive(name)) return { ok: false, reason: 'blocked' }
  return { ok: true }
}
