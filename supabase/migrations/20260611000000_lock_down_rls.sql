-- Security lockdown for the server-authoritative relaunch.
--
-- The game server (service role) is now the ONLY writer. Anonymous clients
-- could previously INSERT/UPDATE any leaderboard row and DELETE bite records,
-- which made every score forgeable. Reads stay public.

-- leaderboard: read-only for the public
DROP POLICY IF EXISTS "Anyone can insert scores" ON public.leaderboard;
DROP POLICY IF EXISTS "Anyone can update scores" ON public.leaderboard;

-- agent_bites: obsolete (bites now live in server memory) — remove all
-- public access. Table kept for historical data; drop it when convenient.
DROP POLICY IF EXISTS "Anyone can insert bites" ON public.agent_bites;
DROP POLICY IF EXISTS "Anyone can read bites" ON public.agent_bites;
DROP POLICY IF EXISTS "Anyone can delete bites" ON public.agent_bites;

-- chat_messages: chat moved to the game server — stop public writes.
-- History stays readable so old logs aren't lost.
DROP POLICY IF EXISTS "Anyone can insert chat messages" ON public.chat_messages;
