import type { Deps } from './env'

export class UpstreamError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export interface GenerateOptions {
  maxTokens: number
  temperature: number
  /**
   * gemini-2.5-flash counts its "thinking" tokens against maxTokens, so for short answers it is switched off
   * (otherwise there may be no room left for the answer).
   */
  thinking: boolean
}

const MAX_ATTEMPTS = 3

/** One Gemini call. Retries "busy" answers (503 / 429) a couple of times. */
export async function generate(
  deps: Pick<Deps, 'fetch' | 'sleep'>, apiKey: string, model: string, prompt: string, opts: GenerateOptions
): Promise<string> {
  const generationConfig: Record<string, unknown> = { maxOutputTokens: opts.maxTokens, temperature: opts.temperature }
  if (!opts.thinking) generationConfig['thinkingConfig'] = { thinkingBudget: 0 }
  const body = JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig })
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`

  for (let attempt = 1; ; attempt++) {
    const res = await deps.fetch(url, {
      method: 'POST',
      // the key goes in a header, never in the URL, so it cannot end up in logs
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body
    })
    if ((res.status === 503 || res.status === 429) && attempt < MAX_ATTEMPTS) {
      await deps.sleep(1500 * attempt)
      continue
    }
    if (!res.ok) throw new UpstreamError(res.status, `Gemini answered HTTP ${res.status}`)
    return extractText(await res.json())
  }
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[]
}

function extractText(json: unknown): string {
  const cand = (json as GeminiResponse).candidates?.[0]
  if (!cand) throw new UpstreamError(502, 'Gemini returned no answer')
  const text = (cand.content?.parts ?? [])
    .filter(p => !p.thought)
    .map(p => p.text ?? '')
    .join('')
    .trim()
  if (!text) throw new UpstreamError(502, `Gemini answer was empty (${cand.finishReason ?? 'unknown'})`)
  return text
}
