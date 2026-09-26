-- Task history and one model for repeating tasks.
--
-- History: tasks get completed_at / started_at, and every change that
-- matters for learning (created, moved, started, completed, skipped,
-- reopened, deleted) is written to task_events by a trigger. Insights and
-- reviews are built from what actually happened, not from the plan.
--
-- Repeats: a routine or repeating task is one row in task_series; its
-- occurrences are ordinary tasks with series_id + occurrence_date, created a
-- few weeks ahead by the app (lib/series.ts). Deleting an occurrence adds its
-- date to the series' exceptions so it isn't created again. This replaces
-- tasks.repeat and the persona's "habits" list.

-- 1. New task fields
alter table public.tasks
  add column if not exists completed_at timestamptz,
  add column if not exists started_at timestamptz,
  add column if not exists energy text,
  add column if not exists is_fixed boolean not null default false,
  add column if not exists source text not null default 'user';

alter table public.tasks
  drop constraint if exists tasks_energy_check,
  add constraint tasks_energy_check check (energy is null or energy in ('deep', 'light')),
  drop constraint if exists tasks_source_check,
  add constraint tasks_source_check check (source in ('user', 'ai', 'suggestion', 'system')),
  drop constraint if exists tasks_priority_check,
  add constraint tasks_priority_check check (priority in ('low', 'medium', 'high', 'very_high'));

-- "rescheduled" was a state standing in for history: a moved task is just to do
update public.tasks set status = 'todo' where status = 'rescheduled';
alter table public.tasks drop constraint if exists tasks_status_check;
alter table public.tasks add constraint tasks_status_check
  check (status in ('todo', 'in_progress', 'done', 'skipped'));

update public.tasks set completed_at = coalesce(created_at, now())
where status = 'done' and completed_at is null;

create index if not exists tasks_user_completed_idx on public.tasks (user_id, completed_at);

-- 2. Event log
create table if not exists public.task_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  task_id uuid, -- no foreign key: history outlives deleted tasks
  series_id uuid,
  type text not null check (type in ('created', 'moved', 'started', 'completed', 'reopened', 'skipped', 'deleted')),
  title text,
  from_date date,
  to_date date,
  from_time time,
  to_time time,
  source text not null default 'user' check (source in ('user', 'ai', 'system')),
  created_at timestamptz not null default now()
);

create index if not exists task_events_user_created_idx on public.task_events (user_id, created_at desc);
create index if not exists task_events_task_idx on public.task_events (task_id);

alter table public.task_events enable row level security;
drop policy if exists "Users can view their own task events" on public.task_events;
create policy "Users can view their own task events" on public.task_events
  for select using ((select auth.uid()) = user_id);
revoke all on public.task_events from anon, authenticated;
grant select on public.task_events to authenticated;

-- 3. Series
create table if not exists public.task_series (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 150),
  description text,
  pattern jsonb not null, -- lib/assistant/patterns.ts Pattern
  start_date date not null,
  until date,
  count int check (count is null or count between 1 and 1000),
  due_time time,
  end_time time,
  estimated_duration int check (estimated_duration is null or estimated_duration between 1 and 1440),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'very_high')),
  category text,
  energy text check (energy is null or energy in ('deep', 'light')),
  project_id uuid references public.projects (id) on delete set null,
  goal_id uuid references public.goals (id) on delete set null,
  is_routine boolean not null default false, -- a habit (gym, prayer, reading) vs repeating work
  exceptions date[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists task_series_user_idx on public.task_series (user_id);
create index if not exists task_series_project_idx on public.task_series (project_id);
create index if not exists task_series_goal_idx on public.task_series (goal_id);

alter table public.task_series enable row level security;
drop policy if exists "Users can view their own series" on public.task_series;
drop policy if exists "Users can insert their own series" on public.task_series;
drop policy if exists "Users can update their own series" on public.task_series;
drop policy if exists "Users can delete their own series" on public.task_series;
create policy "Users can view their own series" on public.task_series
  for select using ((select auth.uid()) = user_id);
create policy "Users can insert their own series" on public.task_series
  for insert with check ((select auth.uid()) = user_id);
create policy "Users can update their own series" on public.task_series
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete their own series" on public.task_series
  for delete using ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.task_series to authenticated;

alter table public.tasks
  add column if not exists series_id uuid references public.task_series (id) on delete set null,
  add column if not exists occurrence_date date;

-- One task per series per scheduled day (NULLs never collide, so ordinary
-- tasks are unaffected). Lets the app create occurrences idempotently.
create unique index if not exists tasks_series_occurrence_key on public.tasks (series_id, occurrence_date);

-- 4. Move old repeating tasks into series
do $$
declare
  t record;
  v_series uuid;
  v_pattern jsonb;
begin
  for t in select * from public.tasks where repeat is not null loop
    v_pattern := case t.repeat
      when 'daily' then '{"type": "daily"}'::jsonb
      when 'weekly' then jsonb_build_object('type', 'days_of_week', 'days',
        jsonb_build_array(lower(to_char(coalesce(t.due_date, current_date), 'dy'))))
      else jsonb_build_object('type', 'monthly', 'day',
        extract(day from coalesce(t.due_date, current_date))::int)
    end;
    insert into public.task_series (user_id, title, description, pattern, start_date, due_time, end_time,
                                    estimated_duration, priority, category, project_id, goal_id)
    values (t.user_id, t.title, t.description, v_pattern, coalesce(t.due_date, current_date), t.due_time,
            t.end_time, t.estimated_duration, coalesce(t.priority, 'medium'), t.category, t.project_id, t.goal_id)
    returning id into v_series;
    update public.tasks
    set series_id = v_series, occurrence_date = coalesce(due_date, current_date)
    where id = t.id;
  end loop;
end $$;

alter table public.tasks drop column if exists repeat;

-- 5. Move persona "habits" into series (routines)
insert into public.task_series (user_id, title, pattern, start_date, due_time, estimated_duration, is_routine)
select p.id,
       left(h ->> 'name', 150),
       h -> 'pattern',
       current_date,
       case when (h ->> 'time') ~ '^\d{2}:\d{2}$' then (h ->> 'time')::time end,
       case when (h ->> 'duration') ~ '^\d+$' then least((h ->> 'duration')::int, 1440) end,
       true
from public.profiles p,
     jsonb_array_elements(case when jsonb_typeof(p.ai_profile -> 'habits') = 'array'
                               then p.ai_profile -> 'habits' else '[]'::jsonb end) h
where coalesce(h ->> 'name', '') <> '' and jsonb_typeof(h -> 'pattern') = 'object';

update public.profiles set ai_profile = ai_profile - 'habits' where ai_profile ? 'habits';

-- 6. Triggers: completion / start times, the event log, series exceptions
create or replace function public.tasks_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'done' then
    if tg_op = 'INSERT' then
      new.completed_at := coalesce(new.completed_at, now());
    elsif old.status is distinct from 'done' then
      new.completed_at := now();
    end if;
  else
    new.completed_at := null;
  end if;

  if new.status = 'in_progress' and new.started_at is null then
    new.started_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_before_write on public.tasks;
create trigger tasks_before_write
  before insert or update on public.tasks
  for each row execute function public.tasks_before_write();

-- Who made the change: the AI apply function sets lifeos.source = 'ai' for
-- its transaction; the app sets 'system' for automatic housekeeping.
create or replace function public.change_source()
returns text
language sql
stable
set search_path = ''
as $$
  select case coalesce(current_setting('lifeos.source', true), '')
    when 'ai' then 'ai'
    when 'system' then 'system'
    else 'user'
  end;
$$;

create or replace function public.tasks_log_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source text := public.change_source();
begin
  if tg_op = 'INSERT' then
    if new.parent_id is null then
      insert into public.task_events (user_id, task_id, series_id, type, title, to_date, to_time, source)
      values (new.user_id, new.id, new.series_id, 'created', new.title, new.due_date, new.due_time, v_source);
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    -- Deleting the whole account cascades here: no history for a user who is gone
    if not exists (select 1 from auth.users where id = old.user_id) then
      return old;
    end if;
    if old.parent_id is null then
      insert into public.task_events (user_id, task_id, series_id, type, title, from_date, from_time, source)
      values (old.user_id, old.id, old.series_id, 'deleted', old.title, old.due_date, old.due_time, v_source);
    end if;
    -- Don't recreate a deleted occurrence (only the task owner's own series)
    if old.series_id is not null and old.occurrence_date is not null then
      update public.task_series
      set exceptions = array_append(exceptions, old.occurrence_date)
      where id = old.series_id and user_id = old.user_id and not (old.occurrence_date = any (exceptions));
    end if;
    return old;
  end if;

  -- UPDATE (subtasks only matter through their parent)
  if new.parent_id is not null then
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.task_events (user_id, task_id, series_id, type, title, from_date, to_date,
                                    from_time, to_time, source)
    values (new.user_id, new.id, new.series_id,
            case
              when new.status = 'done' then 'completed'
              when new.status = 'skipped' then 'skipped'
              when new.status = 'in_progress' and old.status = 'todo' then 'started'
              else 'reopened'
            end,
            new.title, old.due_date, new.due_date, old.due_time, new.due_time, v_source);
  end if;

  if new.due_date is distinct from old.due_date or new.due_time is distinct from old.due_time then
    insert into public.task_events (user_id, task_id, series_id, type, title, from_date, to_date,
                                    from_time, to_time, source)
    values (new.user_id, new.id, new.series_id, 'moved', new.title, old.due_date, new.due_date,
            old.due_time, new.due_time, v_source);
  end if;
  return new;
end;
$$;

revoke execute on function public.tasks_log_events() from public, anon, authenticated;

drop trigger if exists tasks_log_events on public.tasks;
create trigger tasks_log_events
  after insert or update or delete on public.tasks
  for each row execute function public.tasks_log_events();

-- Housekeeping from the app (auto-skipping missed routine occurrences) is
-- recorded as 'system'
create or replace function public.skip_missed_occurrences(p_before date)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  n int;
begin
  perform set_config('lifeos.source', 'system', true);
  update public.tasks
  set status = 'skipped'
  where user_id = auth.uid()
    and series_id is not null
    and due_date < p_before
    and status in ('todo', 'in_progress');
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.skip_missed_occurrences(date) from public, anon;
grant execute on function public.skip_missed_occurrences(date) to authenticated;
