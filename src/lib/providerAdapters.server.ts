// Server-only adapters for BYO-key AI providers.
// Each adapter can (1) validate an API key against the provider's `/models`
// endpoint and (2) build a streaming chat-completions request compatible with
// the OpenAI SSE format the client already parses.
import { type ProviderId } from "./providers";
export type { ProviderId } from "./providers";
export { PROVIDER_LABELS, PROVIDER_HELP, ALL_PROVIDERS } from "./providers";


interface ProviderConfig {
  validateUrl: string;
  chatUrl: string;
  headers: (key: string) => Record<string, string>;
  stripModelPrefix: boolean; // when true, remove `vendor/` before sending
  // Optional model translation. For Anthropic, OpenAI-compat requires the raw model id.
}

const CONFIGS: Record<ProviderId, ProviderConfig> = {
  openai: {
    validateUrl: "https://api.openai.com/v1/models",
    chatUrl: "https://api.openai.com/v1/chat/completions",
    headers: (k) => ({ Authorization: `Bearer ${k}`, "Content-Type": "application/json" }),
    stripModelPrefix: true,
  },
  gemini: {
    // Google's OpenAI-compatible endpoint.
    validateUrl: "https://generativelanguage.googleapis.com/v1beta/openai/models",
    chatUrl: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    headers: (k) => ({ Authorization: `Bearer ${k}`, "Content-Type": "application/json" }),
    stripModelPrefix: true,
  },
  openrouter: {
    validateUrl: "https://openrouter.ai/api/v1/key",
    chatUrl: "https://openrouter.ai/api/v1/chat/completions",
    headers: (k) => ({
      Authorization: `Bearer ${k}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://flowstep.app",
      "X-Title": "Flowstep",
    }),
    stripModelPrefix: false, // OpenRouter uses vendor/model natively
  },
  anthropic: {
    validateUrl: "https://api.anthropic.com/v1/models",
    chatUrl: "https://api.anthropic.com/v1/chat/completions",
    headers: (k) => ({
      "x-api-key": k,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    }),
    stripModelPrefix: true,
  },
  nvidia: {
    validateUrl: "https://integrate.api.nvidia.com/v1/models",
    chatUrl: "https://integrate.api.nvidia.com/v1/chat/completions",
    headers: (k) => ({ Authorization: `Bearer ${k}`, "Content-Type": "application/json" }),
    stripModelPrefix: false,
  },
  groq: {
    validateUrl: "https://api.groq.com/openai/v1/models",
    chatUrl: "https://api.groq.com/openai/v1/chat/completions",
    headers: (k) => ({ Authorization: `Bearer ${k}`, "Content-Type": "application/json" }),
    stripModelPrefix: true,
  },
};

/** Validate an API key by hitting the provider's models endpoint. */
export async function validateProviderKey(
  provider: ProviderId,
  apiKey: string,
): Promise<{ ok: boolean; status: number; message?: string }> {
  const cfg = CONFIGS[provider];
  try {
    const res = await fetch(cfg.validateUrl, { method: "GET", headers: cfg.headers(apiKey) });
    if (res.ok) return { ok: true, status: res.status };
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.text();
      const trimmed = body.slice(0, 300);
      if (trimmed) msg = trimmed;
    } catch {}
    return { ok: false, status: res.status, message: msg };
  } catch (err) {
    return { ok: false, status: 0, message: err instanceof Error ? err.message : "Network error" };
  }
}

/** Pick the best BYO provider for a given `vendor/model` string. */
export function pickProviderForModel(
  modelId: string,
  availableProviders: Set<ProviderId>,
): ProviderId | null {
  const vendor = modelId.split("/")[0]?.toLowerCase();
  if (vendor === "openai" && availableProviders.has("openai")) return "openai";
  if (vendor === "google" && availableProviders.has("gemini")) return "gemini";
  if (vendor === "anthropic" && availableProviders.has("anthropic")) return "anthropic";
  // Fallback: OpenRouter can route almost any vendor/model.
  if (availableProviders.has("openrouter")) return "openrouter";
  // Last-ditch — try direct vendor if we have their key.
  if (vendor === "openai" && availableProviders.has("openai")) return "openai";
  return null;
}

/** Map a Lovable-gateway `vendor/model` id to the model id the provider's own API expects. */
function mapModelForProvider(provider: ProviderId, modelId: string): string {
  const [, name = ""] = modelId.split("/");
  const lower = name.toLowerCase();
  if (provider === "gemini") {
    // Use Google's "-latest" aliases so retired versions don't 404 the request.
    if (lower.includes("pro")) return "gemini-pro-latest";
    if (lower.includes("flash-lite") || lower.includes("flash_lite")) return "gemini-flash-lite-latest";
    if (lower.includes("flash")) return "gemini-flash-latest";
    return "gemini-flash-latest";
  }
  if (provider === "openai") {
    // Lovable exposes future ids like gpt-5.5 that don't exist on OpenAI direct — fall back to a real strong model.
    if (lower.startsWith("gpt-5") || lower.startsWith("gpt-6") || lower.includes("sol") || lower.includes("terra") || lower.includes("luna"))
      return lower.includes("mini") || lower.includes("nano") ? "gpt-4o-mini" : "gpt-4o";
    return name || "gpt-4o";
  }
  if (provider === "anthropic") {
    if (lower.includes("haiku")) return "claude-3-5-haiku-latest";
    if (lower.includes("opus")) return "claude-opus-4-20250514";
    return "claude-sonnet-4-20250514";
  }
  if (provider === "openrouter") return modelId; // native vendor/model
  return name || modelId;
}

/** Pull the human-readable error out of a provider's error body. */
export function providerErrorMessage(provider: ProviderId, status: number, body: string): string {
  let detail = "";
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string };
    if (typeof parsed.error === "string") detail = parsed.error;
    else if (parsed.error?.message) detail = parsed.error.message;
  } catch {
    detail = body.slice(0, 300);
  }
  if (status === 429)
    return `Your ${provider} key hit its rate limit or free-tier quota. ${detail || "Wait a minute and try again, or use a key with a paid quota."}`;
  if (status === 401 || status === 403)
    return `Your ${provider} key was rejected (${status}). Re-add it on the API keys page. ${detail}`.trim();
  if (status === 404)
    return `That model isn't available on your ${provider} key. ${detail}`.trim();
  return detail || `${provider} request failed (${status})`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Kick off an upstream streaming chat completion using the user's key.
 * Free-tier keys (Gemini especially) rate-limit aggressively, so retry 429/5xx
 * with backoff and fall back to a lighter model when the requested one is
 * unavailable or throttled.
 */
export async function streamChatWithUserKey(params: {
  provider: ProviderId;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  /** Partial output already produced — used to resume a truncated generation. */
  continueFrom?: string;
}): Promise<Response> {
  const cfg = CONFIGS[params.provider];
  const primary = params.provider === "openrouter"
    ? params.model
    : mapModelForProvider(params.provider, params.model);
  const candidates = [primary];
  if (params.provider === "gemini") {
    // Free Gemini keys have no quota on the "-latest" / preview aliases (they resolve to paid
    // tiers and 429 immediately), so fall through to models a free key can actually serve.
    for (const fallback of ["gemini-flash-latest", "gemini-2.5-flash", "gemini-flash-lite-latest"]) {
      if (!candidates.includes(fallback)) candidates.push(fallback);
    }
  }

  const attempt = async (model: string) => {
    const messages: Array<{ role: string; content: string }> = [
      { role: "system", content: params.systemPrompt },
      { role: "user", content: params.userPrompt },
    ];
    if (params.continueFrom) {
      messages.push({ role: "assistant", content: params.continueFrom });
      messages.push({
        role: "user",
        content:
          "Your previous message was cut off. Continue the output from exactly where it stopped, mid-token if needed. Do not repeat anything already sent, do not restart, do not add commentary or code fences.",
      });
    }
    const body: Record<string, unknown> = {
      model,
      stream: true,
      // Design HTML can run 700+ lines — give the model room so output isn't truncated mid-document.
      max_tokens: 16384,
      messages,
    };

    // OpenAI's newer reasoning models reject sampling knobs but need generous completion budget.
    if (params.provider === "openai" && /^(o\d|gpt-5|gpt-6)/i.test(model)) {
      delete body.max_tokens;
      body.max_completion_tokens = 16384;
    }
    return fetch(cfg.chatUrl, {
      method: "POST",
      headers: cfg.headers(params.apiKey),
      body: JSON.stringify(body),
    });
  };

  let last: Response | null = null;
  for (const model of candidates) {
    // A 429 here is a per-model quota block, not a burst limit — move to the next
    // model instead of burning seconds on backoff. Only 5xx is worth retrying.
    const maxTries = 3;
    for (let tries = 0; tries < maxTries; tries += 1) {
      const res = await attempt(model);
      if (res.ok) return res;
      last = res;
      if (res.status < 500) break;
      if (tries < maxTries - 1) {
        await res.body?.cancel().catch(() => {});
        await sleep(2000 * (tries + 1));
      }
    }
    if (last && last.status !== 429 && last.status !== 404 && last.status < 500) break;
  }
  return last as Response;
}

