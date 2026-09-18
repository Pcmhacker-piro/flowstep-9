CREATE TABLE IF NOT EXISTS public.provider_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('openai','gemini','openrouter','anthropic','nvidia','groq')),
  model text NOT NULL,
  source text NOT NULL DEFAULT 'design',
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  estimated_cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS provider_usage_events_user_provider_idx
  ON public.provider_usage_events (user_id, provider, created_at DESC);

GRANT SELECT, INSERT ON public.provider_usage_events TO authenticated;
GRANT ALL ON public.provider_usage_events TO service_role;

ALTER TABLE public.provider_usage_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own usage" ON public.provider_usage_events;
CREATE POLICY "Users can view their own usage"
  ON public.provider_usage_events FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own usage" ON public.provider_usage_events;
CREATE POLICY "Users can insert their own usage"
  ON public.provider_usage_events FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
