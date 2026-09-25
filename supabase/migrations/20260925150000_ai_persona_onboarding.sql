-- AI persona: first-time onboarding, "My AI Profile", suggestions and weekly reviews.

-- 1. Profiles: the structured AI profile and onboarding state
alter table public.profiles
  add column if not exists ai_profile jsonb not null default '{}'::jsonb,
  add column if not exists onboarding_status text not null default 'pending',
  add column if not exists updated_at timestamptz not null default now();

alter table public.profiles
  drop constraint if exists profiles_onboarding_status_check,
  add constraint profiles_onboarding_status_check
    check (onboarding_status in ('pending', 'skipped', 'done'));

-- ai_personality existed but was never chosen by anyone; start everyone on balanced
update public.profiles set ai_personality = 'balanced';
alter table public.profiles alter column ai_personality set default 'balanced';
alter table public.profiles
  drop constraint if exists profiles_ai_personality_check,
  add constraint profiles_ai_personality_check
    check (ai_personality in ('friendly', 'direct', 'coach', 'professional', 'teacher', 'balanced'));

-- Every account gets a profile row (older accounts were missing one)
insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2. Goals: why it matters, priority and weekly time
alter table public.goals
  add column if not exists why text,
  add column if not exists priority text,
  add column if not exists weekly_hours numeric(4, 1);

alter table public.goals
  drop constraint if exists goals_priority_check,
  add constraint goals_priority_check
    check (priority is null or priority in ('low', 'medium', 'high', 'very_high')),
  drop constraint if exists goals_weekly_hours_check,
  add constraint goals_weekly_hours_check
    check (weekly_hours is null or (weekly_hours >= 0 and weekly_hours <= 100)),
  drop constraint if exists goals_progress_check,
  add constraint goals_progress_check
    check (progress is null or (progress >= 0 and progress <= 100));

-- 3. Projects also hold courses (kind = 'course', deadline = exam date) and work
alter table public.projects
  add column if not exists kind text not null default 'project',
  add column if not exists importance text,
  add column if not exists difficulty text,
  add column if not exists weekly_hours numeric(4, 1),
  add column if not exists progress int not null default 0,
  add column if not exists ai_help boolean not null default true;

alter table public.projects
  drop constraint if exists projects_kind_check,
  add constraint projects_kind_check
    check (kind in ('course', 'university', 'graduation', 'personal', 'freelance', 'business',
                    'internship', 'job', 'research', 'project', 'other')),
  drop constraint if exists projects_importance_check,
  add constraint projects_importance_check
    check (importance is null or importance in ('low', 'medium', 'high', 'very_high')),
  drop constraint if exists projects_difficulty_check,
  add constraint projects_difficulty_check
    check (difficulty is null or difficulty in ('easy', 'medium', 'hard')),
  drop constraint if exists projects_weekly_hours_check,
  add constraint projects_weekly_hours_check
    check (weekly_hours is null or (weekly_hours >= 0 and weekly_hours <= 100)),
  drop constraint if exists projects_progress_check,
  add constraint projects_progress_check check (progress >= 0 and progress <= 100);

-- 4. Weekly reviews (one per user per week, Monday start)
create table if not exists public.weekly_reviews (
  user_id uuid not null references auth.users (id) on delete cascade,
  week_start date not null,
  review jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, week_start)
);

alter table public.weekly_reviews enable row level security;

drop policy if exists "Users can view their own reviews" on public.weekly_reviews;
create policy "Users can view their own reviews" on public.weekly_reviews
  for select using ((select auth.uid()) = user_id);
drop policy if exists "Users can insert their own reviews" on public.weekly_reviews;
create policy "Users can insert their own reviews" on public.weekly_reviews
  for insert with check ((select auth.uid()) = user_id);
drop policy if exists "Users can update their own reviews" on public.weekly_reviews;
create policy "Users can update their own reviews" on public.weekly_reviews
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Users can delete their own reviews" on public.weekly_reviews;
create policy "Users can delete their own reviews" on public.weekly_reviews
  for delete using ((select auth.uid()) = user_id);

grant select, insert, update, delete on table public.weekly_reviews to authenticated;

-- 5. Separate AI budgets that don't use the 10 daily questions:
--    onboarding chat, daily suggestions and weekly reviews
create table if not exists public.ai_usage_extra (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null default current_date,
  kind text not null check (kind in ('onboarding', 'suggest', 'review')),
  count int not null default 0,
  primary key (user_id, day, kind)
);

alter table public.ai_usage_extra enable row level security;

drop policy if exists "Users can view their own extra AI usage" on public.ai_usage_extra;
create policy "Users can view their own extra AI usage" on public.ai_usage_extra
  for select using ((select auth.uid()) = user_id);

grant select on table public.ai_usage_extra to authenticated;

-- Returns how many are left of that kind today, or -1 when the limit is reached
create or replace function public.consume_extra_ai_credit(credit_kind text)
returns int
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  daily_limit int;
  used int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  daily_limit := case credit_kind
    when 'onboarding' then 40
    when 'suggest' then 5
    when 'review' then 3
    else null
  end;
  if daily_limit is null then
    raise exception 'unknown credit kind %', credit_kind;
  end if;

  insert into public.ai_usage_extra (user_id, day, kind, count)
  values (auth.uid(), current_date, credit_kind, 1)
  on conflict (user_id, day, kind)
  do update set count = public.ai_usage_extra.count + 1
  where public.ai_usage_extra.count < daily_limit
  returning count into used;

  if used is null then
    return -1;
  end if;
  return daily_limit - used;
end;
$$;

revoke execute on function public.consume_extra_ai_credit(text) from public, anon;
grant execute on function public.consume_extra_ai_credit(text) to authenticated;

create index if not exists projects_user_kind_idx on public.projects (user_id, kind);
