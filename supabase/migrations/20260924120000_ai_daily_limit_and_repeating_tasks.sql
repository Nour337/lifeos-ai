-- Applied to the Supabase project on 2026-09-24.

-- Repeating tasks: completing one moves its due date to the next occurrence.
alter table public.tasks
  add column if not exists repeat text
  check (repeat in ('daily', 'weekly', 'monthly'));

-- Per-user daily AI usage. Users can read their own row but never write it;
-- only consume_ai_credit() (security definer) can change the count.
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default current_date,
  count int not null default 0,
  primary key (user_id, day)
);

alter table public.ai_usage enable row level security;

create policy "Users can view their own AI usage"
  on public.ai_usage for select
  using (auth.uid() = user_id);

-- Atomically uses one AI credit for today (UTC). Returns credits left after
-- this one, or -1 when the daily limit is already reached.
-- Keep daily_limit in sync with AI_DAILY_LIMIT in lib/ai/limits.ts.
create or replace function public.consume_ai_credit()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  daily_limit constant int := 10;
  used int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into public.ai_usage (user_id, day, count)
  values (auth.uid(), current_date, 1)
  on conflict (user_id, day)
  do update set count = public.ai_usage.count + 1
  where public.ai_usage.count < daily_limit
  returning count into used;

  if used is null then
    return -1;
  end if;
  return daily_limit - used;
end;
$$;

revoke execute on function public.consume_ai_credit() from public, anon;
grant execute on function public.consume_ai_credit() to authenticated;
