ALTER TABLE public.leaderboard ADD COLUMN weight INTEGER NOT NULL DEFAULT 100;
CREATE INDEX idx_leaderboard_weight ON public.leaderboard (weight DESC);