-- Signed-in users read their own usage (RLS limits it to their row) to show
-- credits left. Writes only happen through consume_ai_credit().
grant select on table public.ai_usage to authenticated;
