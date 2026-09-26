-- One AI budget for everyone (the persona is context, not a pricing tier).
--
-- Every AI request reserves points with consume_ai(kind) before the model is
-- called and settles with finish_ai(call_id, ok, ...) afterwards: a failed
-- call (timeout, bad answer) gives its points back. The allowance lives in
-- `entitlements`, which users can read but never write, so nothing the
-- browser changes can raise it. Days follow the user's own timezone.

-- 1. Timezone (IANA name, e.g. "Africa/Cairo"), set by the app on login
alter table public.profiles
  add column if not exists timezone text not null default 'UTC';

create or replace function public.profiles_clean()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- An unknown timezone would break every date calculation: fall back to UTC
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    new.timezone := 'UTC';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_clean on public.profiles;
create trigger profiles_clean
  before insert or update of timezone on public.profiles
  for each row execute function public.profiles_clean();

-- The persona is edited by its owner; cap its size so it can't be abused as storage
alter table public.profiles
  drop constraint if exists profiles_ai_profile_size,
  add constraint profiles_ai_profile_size check (pg_column_size(ai_profile) < 65536);

-- 2. Entitlements: the daily AI allowance. Read-only for users.
create table if not exists public.entitlements (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'plus', 'pro')),
  daily_points int not null default 30 check (daily_points between 0 and 10000),
  updated_at timestamptz not null default now()
);

alter table public.entitlements enable row level security;
drop policy if exists "Users can view their own entitlements" on public.entitlements;
create policy "Users can view their own entitlements" on public.entitlements
  for select using ((select auth.uid()) = user_id);
revoke all on public.entitlements from anon, authenticated;
grant select on public.entitlements to authenticated;

insert into public.entitlements (user_id)
select id from auth.users
on conflict (user_id) do nothing;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  insert into public.entitlements (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- 3. Every AI call: what it cost, whether it worked, tokens used
create table if not exists public.ai_calls (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('chat', 'now', 'suggest', 'review', 'steps', 'onboarding', 'summarize')),
  cost int not null default 0,
  status text not null default 'reserved' check (status in ('reserved', 'ok', 'failed')),
  model text,
  input_tokens int,
  output_tokens int,
  latency_ms int,
  created_at timestamptz not null default now()
);

create index if not exists ai_calls_user_created_idx on public.ai_calls (user_id, created_at desc);

alter table public.ai_calls enable row level security;
drop policy if exists "Users can view their own AI calls" on public.ai_calls;
create policy "Users can view their own AI calls" on public.ai_calls
  for select using ((select auth.uid()) = user_id);
revoke all on public.ai_calls from anon, authenticated;
grant select on public.ai_calls to authenticated;

-- ai_usage.count is now points used on the user's local day
comment on column public.ai_usage.count is 'AI points used that (user-local) day';

-- The user's local date
create or replace function public.user_today(uid uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone coalesce(
    (select p.timezone from public.profiles p where p.id = uid), 'UTC'))::date;
$$;

revoke execute on function public.user_today(uuid) from public, anon, authenticated;

-- Cost of each kind of AI request, in points. Keep in sync with AI_COSTS in
-- lib/ai/usage.ts. onboarding and summarize are free but capped per day.
create or replace function public.ai_cost(p_kind text)
returns int
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'chat' then 1
    when 'now' then 1
    when 'suggest' then 1
    when 'steps' then 1
    when 'review' then 2
    when 'onboarding' then 0
    when 'summarize' then 0
  end;
$$;

-- Reserves the points for one AI request. Returns
--   {"call_id", "remaining", "limit"} on success, or
--   {"error": "daily_limit" | "rate_limit" | "kind_limit", "limit"}.
create or replace function public.consume_ai(p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_cost int := public.ai_cost(p_kind);
  v_day date;
  v_limit int;
  v_cap int;
  v_used int;
  v_id bigint;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if v_cost is null then
    raise exception 'unknown AI kind %', p_kind;
  end if;

  v_day := public.user_today(uid);

  -- Burst limit against scripts: 10 AI calls a minute
  if (select count(*) from public.ai_calls
      where user_id = uid and created_at > now() - interval '1 minute') >= 10 then
    return jsonb_build_object('error', 'rate_limit');
  end if;

  -- Free kinds still have a daily ceiling
  v_cap := case p_kind when 'onboarding' then 60 else 100 end;
  if v_cost = 0 and (select count(*) from public.ai_calls
      where user_id = uid and day = v_day and kind = p_kind and status <> 'failed') >= v_cap then
    return jsonb_build_object('error', 'kind_limit');
  end if;

  v_limit := coalesce((select e.daily_points from public.entitlements e where e.user_id = uid), 30);

  if v_cost > 0 then
    insert into public.ai_usage (user_id, day, count)
    values (uid, v_day, v_cost)
    on conflict (user_id, day)
    do update set count = public.ai_usage.count + v_cost
    where public.ai_usage.count + v_cost <= v_limit
    returning count into v_used;

    if v_used is null or v_used > v_limit then
      -- (a first request costing more than the whole allowance)
      if v_used is not null then
        update public.ai_usage set count = count - v_cost where user_id = uid and day = v_day;
      end if;
      return jsonb_build_object('error', 'daily_limit', 'limit', v_limit);
    end if;
  else
    v_used := coalesce((select u.count from public.ai_usage u where u.user_id = uid and u.day = v_day), 0);
  end if;

  insert into public.ai_calls (user_id, day, kind, cost)
  values (uid, v_day, p_kind, v_cost)
  returning id into v_id;

  return jsonb_build_object('call_id', v_id, 'remaining', greatest(v_limit - v_used, 0), 'limit', v_limit);
end;
$$;

-- Settles a reserved call. A failed call gives its points back (once).
create or replace function public.finish_ai(
  p_call_id bigint,
  p_ok boolean,
  p_model text default null,
  p_input_tokens int default null,
  p_output_tokens int default null,
  p_latency_ms int default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_cost int;
  v_day date;
begin
  update public.ai_calls
  set status = case when p_ok then 'ok' else 'failed' end,
      model = left(p_model, 60),
      input_tokens = p_input_tokens,
      output_tokens = p_output_tokens,
      latency_ms = p_latency_ms
  where id = p_call_id and user_id = uid and status = 'reserved'
  returning cost, day into v_cost, v_day;

  if found and not p_ok and v_cost > 0 then
    update public.ai_usage
    set count = greatest(count - v_cost, 0)
    where user_id = uid and day = v_day;
  end if;
end;
$$;

-- What the screens show: points used / allowance for the user's today
create or replace function public.get_ai_budget()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'used', coalesce((select u.count from public.ai_usage u
                      where u.user_id = auth.uid() and u.day = public.user_today(auth.uid())), 0),
    'limit', coalesce((select e.daily_points from public.entitlements e where e.user_id = auth.uid()), 30),
    'plan', coalesce((select e.plan from public.entitlements e where e.user_id = auth.uid()), 'free')
  );
$$;

revoke execute on function public.consume_ai(text) from public, anon;
revoke execute on function public.finish_ai(bigint, boolean, text, int, int, int) from public, anon;
revoke execute on function public.get_ai_budget() from public, anon;
grant execute on function public.consume_ai(text) to authenticated;
grant execute on function public.finish_ai(bigint, boolean, text, int, int, int) to authenticated;
grant execute on function public.get_ai_budget() to authenticated;

-- 4. The old two-tier system
drop function if exists public.consume_ai_credit();
drop function if exists public.consume_extra_ai_credit(text);
drop table if exists public.ai_usage_extra;
