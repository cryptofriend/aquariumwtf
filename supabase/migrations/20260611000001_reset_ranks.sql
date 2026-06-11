-- Fresh start for the relaunch: wipe all legacy ranks data.
-- The old scores were produced by the client-authoritative build where any
-- client could write anything — none of them are trustworthy.

DELETE FROM public.leaderboard;

-- Obsolete table from the old client-authoritative bite relay.
DELETE FROM public.agent_bites;
