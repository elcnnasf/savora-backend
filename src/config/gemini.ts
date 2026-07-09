import { env } from './env';

// Smart routing tiers:
//   heavy → flash      — recipe generation, meal plans
//   light → flash-lite — chat, suggestions, dish research, scan, calorie analysis
// "-latest" aliases track the newest available model: pinned versions get retired
// (gemini-2.5-flash-lite started returning 404 in July 2026) but aliases keep working.
export const GEMINI_HEAVY_MODEL = 'gemini-flash-latest';
export const GEMINI_LIGHT_MODEL = 'gemini-flash-lite-latest';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface GeminiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GeminiCompleteOptions {
  model: string;
  messages: GeminiChatMessage[];
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
}

export class GeminiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

// Circuit breaker: free-tier daily quotas are tiny (20 req/day/model as of mid-2026).
// Once Google reports the daily quota exhausted, skip Gemini for that model until the
// quota resets (midnight US Pacific) instead of paying a failed roundtrip per request.
const quotaExhaustedUntil: Record<string, number> = {};

function nextQuotaReset(): number {
  // midnight Pacific ≈ 08:00 UTC (using the winter offset errs on the safe side)
  const reset = new Date();
  reset.setUTCHours(8, 0, 0, 0);
  if (reset.getTime() <= Date.now()) reset.setUTCDate(reset.getUTCDate() + 1);
  return reset.getTime();
}

async function callGemini(model: string, body: Record<string, unknown>): Promise<string> {
  if (!env.gemini.apiKey) throw new GeminiError('GEMINI_API_KEY not configured', 0);

  if (Date.now() < (quotaExhaustedUntil[model] ?? 0)) {
    throw new GeminiError(`Gemini ${model} daily quota exhausted — skipping until reset`, 429);
  }

  const res = await fetch(`${BASE_URL}/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': env.gemini.apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    if (res.status === 429 && errText.includes('PerDay')) {
      quotaExhaustedUntil[model] = nextQuotaReset();
      console.warn(`[gemini] ${model} daily free-tier quota exhausted — disabled until ${new Date(quotaExhaustedUntil[model]).toISOString()}`);
    }
    throw new GeminiError(`Gemini ${model} error ${res.status}: ${errText.slice(0, 300)}`, res.status);
  }

  const data = (await res.json()) as any;
  const candidate = data?.candidates?.[0];
  const text = candidate?.content?.parts
    ?.map((p: any) => p.text ?? '')
    .join('') ?? '';

  if (!text) {
    const reason = candidate?.finishReason ?? 'empty response';
    throw new GeminiError(`Gemini ${model} returned no text (${reason})`, 500);
  }
  // A non-STOP finish (MAX_TOKENS, SAFETY, …) means the output is truncated/partial —
  // returning it would feed broken JSON downstream; throw so callers fall back to Groq
  if (candidate.finishReason && candidate.finishReason !== 'STOP') {
    throw new GeminiError(`Gemini ${model} incomplete response (${candidate.finishReason})`, 500);
  }
  return text;
}

export async function geminiComplete(opts: GeminiCompleteOptions): Promise<string> {
  const systemText = opts.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n');

  const contents = opts.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: opts.temperature ?? 0.7,
      maxOutputTokens: opts.maxTokens ?? 2048,
      // Disable thinking — keeps latency/token usage close to the old Groq setup
      thinkingConfig: { thinkingBudget: 0 },
      ...(opts.json ? { responseMimeType: 'application/json' } : {}),
    },
  };
  if (systemText) body.system_instruction = { parts: [{ text: systemText }] };

  return callGemini(opts.model, body);
}

export async function geminiVision(opts: {
  model: string;
  imageBase64: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
}): Promise<string> {
  const body: Record<string, unknown> = {
    contents: [
      {
        role: 'user',
        parts: [
          { inline_data: { mime_type: 'image/jpeg', data: opts.imageBase64 } },
          { text: opts.prompt },
        ],
      },
    ],
    generationConfig: {
      temperature: opts.temperature ?? 0.1,
      maxOutputTokens: opts.maxTokens ?? 1024,
      thinkingConfig: { thinkingBudget: 0 },
      ...(opts.json ? { responseMimeType: 'application/json' } : {}),
    },
  };

  return callGemini(opts.model, body);
}
