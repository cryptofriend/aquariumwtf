-- Add session tracking + bot flag so we can record EVERY entry (human or agent)
-- and update the row as the player's weight changes during their session.

ALTER TABLE public.leaderboard
  ADD COLUMN IF NOT EXISTS session_id UUID UNIQUE DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT false;

-- Allow public updates (scoped by session_id from the client).
-- The leaderboard is intentionally public — same trust model as the existing
-- "Anyone can insert scores" policy.
DROP POLICY IF EXISTS "Anyone can update scores" ON public.leaderboard;
CREATE POLICY "Anyone can update scores"
  ON public.leaderboard
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_leaderboard_session ON public.leaderboard(session_id);
