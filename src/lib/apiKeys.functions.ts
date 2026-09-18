import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { PROVIDER_LABELS, type ProviderId } from "./providers";

const PROVIDERS = ["openai", "gemini", "openrouter", "anthropic", "nvidia", "groq"] as const;

const SaveInput = z.object({
  provider: z.enum(PROVIDERS),
  apiKey: z.string().trim().min(8).max(500),
  label: z.string().trim().max(64).optional(),
});

const DeleteInput = z.object({ provider: z.enum(PROVIDERS) });

export type StoredApiKey = {
  id: string;
  provider: ProviderId;
  providerLabel: string;
  key_last4: string;
  label: string | null;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
};

export const listMyApiKeys = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StoredApiKey[]> => {
    const { data, error } = await context.supabase
      .from("user_api_keys")
      .select("id, provider, key_last4, label, last_verified_at, created_at, updated_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => ({
      id: row.id,
      provider: row.provider as ProviderId,
      providerLabel: PROVIDER_LABELS[row.provider as ProviderId] ?? row.provider,
      key_last4: row.key_last4,
      label: row.label,
      last_verified_at: row.last_verified_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  });

export type ProviderUsage = {
  provider: ProviderId;
  providerLabel: string;
  requests: number;
  estimatedCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  lastUsedAt: string | null;
};

/** Per-provider usage overview for the signed-in user (last 90 days). */
export const listMyProviderUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ProviderUsage[]> => {
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await context.supabase
      .from("provider_usage_events")
      .select("provider, input_tokens, output_tokens, estimated_cost_usd, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error) throw new Error(error.message);

    const totals = new Map<ProviderId, ProviderUsage>();
    for (const row of data ?? []) {
      const provider = row.provider as ProviderId;
      const entry =
        totals.get(provider) ??
        {
          provider,
          providerLabel: PROVIDER_LABELS[provider] ?? provider,
          requests: 0,
          estimatedCostUsd: 0,
          inputTokens: 0,
          outputTokens: 0,
          lastUsedAt: null as string | null,
        };
      entry.requests += 1;
      entry.estimatedCostUsd += Number(row.estimated_cost_usd ?? 0);
      entry.inputTokens += row.input_tokens ?? 0;
      entry.outputTokens += row.output_tokens ?? 0;
      if (!entry.lastUsedAt || row.created_at > entry.lastUsedAt) entry.lastUsedAt = row.created_at;
      totals.set(provider, entry);
    }
    return [...totals.values()]
      .map((u) => ({ ...u, estimatedCostUsd: Number(u.estimatedCostUsd.toFixed(6)) }))
      .sort((a, b) => b.requests - a.requests);
  });

export const saveMyApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => SaveInput.parse(raw))
  .handler(async ({ data, context }) => {
    // 1) live-validate the key against the provider before persisting.
    const { validateProviderKey } = await import("./providerAdapters.server");
    const check = await validateProviderKey(data.provider, data.apiKey);
    if (!check.ok) {
      throw new Error(
        check.status === 401 || check.status === 403
          ? `Provider rejected the key (${check.status}). Double-check it and try again.`
          : `Validation failed (${check.status || "network"}): ${check.message ?? "unknown error"}`,
      );
    }

    // 2) encrypt inside the handler to keep node:crypto out of the client bundle.
    const { encryptKey, last4 } = await import("./keyCrypto.server");
    const ciphertext = encryptKey(data.apiKey);
    const tail = last4(data.apiKey);
    const nowIso = new Date().toISOString();

    const { error } = await context.supabase.from("user_api_keys").upsert(
      {
        user_id: context.userId,
        provider: data.provider,
        key_ciphertext: ciphertext,
        key_last4: tail,
        label: data.label ?? null,
        last_verified_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: "user_id,provider" },
    );
    if (error) throw new Error(error.message);
    return { ok: true, verified_at: nowIso };
  });

export const deleteMyApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => DeleteInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("user_api_keys")
      .delete()
      .eq("user_id", context.userId)
      .eq("provider", data.provider);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const testMyApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => DeleteInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("user_api_keys")
      .select("key_ciphertext")
      .eq("user_id", context.userId)
      .eq("provider", data.provider)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("No key saved for this provider.");
    const { decryptKey } = await import("./keyCrypto.server");
    const plain = decryptKey(row.key_ciphertext);
    const { validateProviderKey } = await import("./providerAdapters.server");
    const check = await validateProviderKey(data.provider, plain);
    if (check.ok) {
      const nowIso = new Date().toISOString();
      await context.supabase
        .from("user_api_keys")
        .update({ last_verified_at: nowIso })
        .eq("user_id", context.userId)
        .eq("provider", data.provider);
      return { ok: true, verified_at: nowIso };
    }
    return { ok: false, status: check.status, message: check.message };
  });
