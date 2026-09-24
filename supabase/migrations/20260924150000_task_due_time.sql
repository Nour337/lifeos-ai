-- Applied to the Supabase project on 2026-09-24.
-- Optional time of day for a task; the Today screen groups tasks into
-- Morning / Afternoon / Evening by it.
alter table public.tasks add column if not exists due_time time;
