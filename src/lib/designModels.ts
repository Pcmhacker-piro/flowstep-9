import type { ProviderId } from "./providers";

/**
 * Models offered in the canvas model picker.
 * `provider: null` => runs on Lovable's included AI credits.
 * `provider: <id>`  => runs on the user's own saved key for that provider.
 */
export const DESIGN_MODELS = [
  { id: "openai/gpt-6-astra", label: "Astra", hint: "Included credits — production-grade product systems and polished UI", provider: null },
  { id: "google/gemini-3.1-pro-preview", label: "Gemini Pro", hint: "Your Google Gemini key — strongest Gemini for detailed screens", provider: "gemini" },
  { id: "google/gemini-3.8-flash", label: "Gemini Flash", hint: "Your Google Gemini key — fast, cheap iterations", provider: "gemini" },
  { id: "openai/gpt-4o", label: "GPT-4o", hint: "Your OpenAI key — reliable all-round UI generation", provider: "openai" },
  { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet", hint: "Your Anthropic key — great taste in layout and copy", provider: "anthropic" },
  { id: "openrouter/auto", label: "OpenRouter (auto)", hint: "Your OpenRouter key — routes to the best available model", provider: "openrouter" },
  { id: "nvidia/meta/llama-3.3-70b-instruct", label: "Llama 3.3 70B", hint: "Your NVIDIA NIM key — open-weight model", provider: "nvidia" },
  { id: "groq/llama-3.3-70b-versatile", label: "Llama 3.3 on Groq", hint: "Your Groq key — very fast generation", provider: "groq" },
] as const;

export type DesignModel = (typeof DESIGN_MODELS)[number];
export type DesignModelId = DesignModel["id"];

export const DEFAULT_DESIGN_MODEL: DesignModelId = "openai/gpt-6-astra";

export function resolveDesignModel(input: unknown): DesignModelId {
  if (typeof input !== "string") return DEFAULT_DESIGN_MODEL;
  return (DESIGN_MODELS.find((m) => m.id === input)?.id ?? DEFAULT_DESIGN_MODEL) as DesignModelId;
}

/** Which saved-key provider a model needs, or null when it runs on included credits. */
export function providerForDesignModel(input: unknown): ProviderId | null {
  const found = DESIGN_MODELS.find((m) => m.id === input);
  return (found?.provider ?? null) as ProviderId | null;
}
