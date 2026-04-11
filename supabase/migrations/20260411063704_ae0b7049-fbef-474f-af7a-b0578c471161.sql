
CREATE TABLE public.agent_bites (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  target_agent_id text NOT NULL,
  attacker_name text NOT NULL DEFAULT 'Unknown',
  damage numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_bites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert bites" ON public.agent_bites FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Anyone can read bites" ON public.agent_bites FOR SELECT TO public USING (true);
CREATE POLICY "Anyone can delete bites" ON public.agent_bites FOR DELETE TO public USING (true);

-- Index for quick lookups by target
CREATE INDEX idx_agent_bites_target ON public.agent_bites (target_agent_id, created_at);
