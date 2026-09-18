// Server-only: record BYO-provider usage so the API keys page can show
// request counts, estimated spend, and last-used timestamps per provider.
import type { ProviderId } from "./providers";

// Rough blended list prices in USD per 1M tokens. Used only to show an estimate
// in the UI — never billed, never authoritative.
const RATES: Record<ProviderId, { input: number; output: number }> = {
  openai: { input: 2.5, output: 10 },
  gemini: { input: 0.3, output: 2.5 },
  openrouter: { input: 1.5, output: 6 },
  anthropic: { input: 3, output: 15 },
  nvidia: { input: 0.2, output: 0.6 },
  groq: { input: 0.3, output: 0.9 },
};

const approxTokens = (text: string) => Math.ceil(text.length / 4);

export function estimateCostUsd(provider: ProviderId, inputTokens: number, outputTokens: number): number {
  const r = RATES[provider];
  if (!r) return 0;
  return Number(((inputTokens * r.input + outputTokens * r.output) / 1_000_000).toFixed(6));
}

export async function logProviderUsage(params: {
  userId: string | null | undefined;
  provider: string;
  model: string;
  source: "design" | "edit";
  promptText?: string;
  outputText?: string;
  inputTokens?: number;
  outputTokens?: number;
}): Promise<void> {
  const provider = params.provider as ProviderId;
  if (!params.userId || !RATES[provider]) return;

  const inputTokens = params.inputTokens ?? approxTokens(params.promptText ?? "");
  const outputTokens = params.outputTokens ?? approxTokens(params.outputText ?? "");

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("provider_usage_events").insert({
      user_id: params.userId,
      provider,
      model: params.model.slice(0, 200),
      source: params.source,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated_cost_usd: estimateCostUsd(provider, inputTokens, outputTokens),
    });
  } catch {
    // Usage logging must never break a generation.
  }
}
