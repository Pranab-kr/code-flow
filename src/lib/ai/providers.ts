/**
 * BYOK provider registry (Plan 5 Task 2).
 *
 * One table of `{ id, label, baseUrl, openaiCompatible, models[], keyHint }`,
 * so a wrong base URL is one row to fix rather than a code change.
 *
 * `opencode-zen` and `nvidia-nim` are listed in PROVIDERS but kept OUT of
 * ENABLED_PROVIDERS: their base URL and OpenAI-compatibility were never
 * confirmed (spec §15 open item). Check the current docs, send one real
 * request, and only then move them over. A provider that 404s is worse than
 * one that is absent.
 */

export interface Provider {
  id: string;
  label: string;
  baseUrl: string;
  openaiCompatible: boolean;
  models: string[];
  defaultModel: string;
  /** Shown next to the input so the user knows they have the right key. */
  keyHint: string;
  /** Where to get one. */
  consoleUrl: string;
}

export const PROVIDERS: Provider[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    openaiCompatible: true,
    models: [],
    defaultModel: 'gpt-4o-mini',
    keyHint: 'starts with sk-',
    consoleUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    openaiCompatible: false,
    models: [],
    defaultModel: 'claude-haiku-4-5',
    keyHint: 'starts with sk-ant-',
    consoleUrl: 'https://console.anthropic.com',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    openaiCompatible: true,
    models: [],
    defaultModel: 'openai/gpt-4o-mini',
    keyHint: 'starts with sk-or-',
    consoleUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'google',
    label: 'Google AI Studio',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    openaiCompatible: false,
    models: [],
    defaultModel: 'gemini-2.0-flash',
    keyHint: '',
    consoleUrl: 'https://aistudio.google.com/apikey',
  },
  // VERIFY these two before shipping — base URL and OpenAI-compatibility were never
  // confirmed (spec §15 open item). Check the current docs, send one real request,
  // and only then fill in models[].
  {
    id: 'opencode-zen',
    label: 'Opencode Zen',
    baseUrl: 'TODO-VERIFY',
    openaiCompatible: true,
    models: [],
    defaultModel: '',
    keyHint: '',
    consoleUrl: 'https://opencode.ai',
  },
  {
    id: 'nvidia-nim',
    label: 'NVIDIA NIM',
    baseUrl: 'TODO-VERIFY',
    openaiCompatible: true,
    models: [],
    defaultModel: '',
    keyHint: 'starts with nvapi-',
    consoleUrl: 'https://build.nvidia.com',
  },
];

/** Ids whose entries are not yet verified — never offered to users. */
const UNVERIFIED_IDS = new Set(['opencode-zen', 'nvidia-nim']);

/** Only providers a user may store a key for. */
export const ENABLED_PROVIDERS: Provider[] = PROVIDERS.filter((p) => !UNVERIFIED_IDS.has(p.id));

export function getProvider(id: string): Provider | undefined {
  return ENABLED_PROVIDERS.find((p) => p.id === id);
}
