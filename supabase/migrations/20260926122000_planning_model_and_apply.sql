-- Goals / projects / milestones / courses, and applying an AI proposal in
-- one transaction.

-- 1. Milestones are projects with kind 'milestone' (hidden from the Projects
--    list, shown under their goal)
alter table public.projects drop constraint if exists projects_kind_check;
alter table public.projects add constraint projects_kind_check
  check (kind in ('course', 'university', 'graduation', 'personal', 'freelance', 'business',
                  'internship', 'job', 'research', 'project', 'milestone', 'other'));

-- 2. Progress is calculated from tasks unless the user sets it by hand
alter table public.projects add column if not exists progress_manual boolean not null default false;
alter table public.goals add column if not exists progress_manual boolean not null default false;
update public.projects set progress_manual = true where progress > 0;
update public.goals set progress_manual = true where coalesce(progress, 0) > 0;

-- 3. Courses have several graded items (midterm, final, quizzes, assignments)
create table if not exists public.assessments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  type text not null default 'exam'
    check (type in ('exam', 'midterm', 'final', 'quiz', 'assignment', 'presentation', 'other')),
  title text not null check (char_length(title) between 1 and 150),
  due_date date not null,
  due_time time,
  weight numeric(5, 2) check (weight is null or (weight >= 0 and weight <= 100)),
  done boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists assessments_user_date_idx on public.assessments (user_id, due_date);
create index if not exists assessments_project_idx on public.assessments (project_id);

alter table public.assessments enable row level security;
drop policy if exists "Users manage their own assessments" on public.assessments;
create policy "Users manage their own assessments" on public.assessments
  for all using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid()))
  );
grant select, insert, update, delete on public.assessments to authenticated;

-- The existing single exam date of a course becomes its first assessment
insert into public.assessments (user_id, project_id, type, title, due_date)
select p.user_id, p.id, 'exam', p.name || ' exam', p.deadline
from public.projects p
where p.kind = 'course' and p.deadline is not null and p.user_id is not null
  and not exists (select 1 from public.assessments a where a.project_id = p.id);

-- 4. Applying a proposal: all or nothing, and at most once per key
create table if not exists public.proposal_applies (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key text not null check (char_length(key) between 8 and 80),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.proposal_applies enable row level security;
drop policy if exists "Users can view their own applies" on public.proposal_applies;
drop policy if exists "Users can insert their own applies" on public.proposal_applies;
create policy "Users can view their own applies" on public.proposal_applies
  for select using ((select auth.uid()) = user_id);
create policy "Users can insert their own applies" on public.proposal_applies
  for insert with check ((select auth.uid()) = user_id);
grant select, insert on public.proposal_applies to authenticated;

-- Payload (built by lib/assistant/apply.ts from an approved proposal):
-- {
--   "new_goal":   {name, description, target_date, why, priority, weekly_hours} | null,
--   "milestones": [{key, name, deadline}],
--   "series":     [{key, title, description, pattern, start_date, until, count, due_time, end_time,
--                   estimated_duration, priority, category, energy, project_id, goal_id,
--                   new_goal, milestone_key, is_routine}],
--   "creates":    [{title, description, due_date, due_time, end_time, estimated_duration, priority,
--                   category, energy, is_fixed, project_id, goal_id, new_goal, milestone_key,
--                   series_key, occurrence_date}],
--   "moves":      [{id, due_time, end_time}],
--   "updates":    [{id, changes: {title, due_date, due_time, end_time, estimated_duration,
--                                 status, priority}}],
--   "series_changes": [{id, action: "stop" | "change", from_date,
--                       changes: {title, due_time, end_time, estimated_duration, pattern}}],
--   "deletes":    [uuid]
-- }
-- Runs as the user (security invoker), so row level security applies to
-- every statement exactly as for manual edits.
create or replace function public.apply_proposal(p_key text, p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_prev jsonb;
  v_goal uuid;
  v_id uuid;
  v_milestones jsonb := '{}';
  v_series jsonb := '{}';
  v_created int := 0;
  v_updated int := 0;
  v_deleted int := 0;
  v_rows int;
  v_result jsonb;
  item jsonb;
  ch jsonb;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  select result into v_prev from public.proposal_applies where user_id = uid and key = p_key;
  if found then
    return v_prev || '{"repeated": true}'::jsonb;
  end if;

  perform set_config('lifeos.source', 'ai', true);

  -- Goal and milestones
  if jsonb_typeof(p_payload -> 'new_goal') = 'object' then
    item := p_payload -> 'new_goal';
    insert into public.goals (user_id, name, description, target_date, why, priority, weekly_hours, progress)
    values (uid, item ->> 'name', item ->> 'description', (item ->> 'target_date')::date, item ->> 'why',
            item ->> 'priority', (item ->> 'weekly_hours')::numeric, 0)
    returning id into v_goal;
  end if;

  for item in select * from jsonb_array_elements(coalesce(p_payload -> 'milestones', '[]')) loop
    insert into public.projects (user_id, name, deadline, goal_id, kind)
    values (uid, item ->> 'name', (item ->> 'deadline')::date, v_goal, 'milestone')
    returning id into v_id;
    v_milestones := v_milestones || jsonb_build_object(item ->> 'key', v_id);
  end loop;

  -- Series (their first weeks of occurrences come in "creates")
  for item in select * from jsonb_array_elements(coalesce(p_payload -> 'series', '[]')) loop
    insert into public.task_series (user_id, title, description, pattern, start_date, until, count,
                                    due_time, end_time, estimated_duration, priority, category, energy,
                                    project_id, goal_id, is_routine)
    values (uid, item ->> 'title', item ->> 'description', item -> 'pattern', (item ->> 'start_date')::date,
            (item ->> 'until')::date, (item ->> 'count')::int, (item ->> 'due_time')::time,
            (item ->> 'end_time')::time, (item ->> 'estimated_duration')::int,
            coalesce(item ->> 'priority', 'medium'), item ->> 'category', item ->> 'energy',
            coalesce((v_milestones ->> (item ->> 'milestone_key'))::uuid, (item ->> 'project_id')::uuid),
            case when (item ->> 'new_goal')::boolean then v_goal else (item ->> 'goal_id')::uuid end,
            coalesce((item ->> 'is_routine')::boolean, false))
    returning id into v_id;
    v_series := v_series || jsonb_build_object(item ->> 'key', v_id);
  end loop;

  -- New tasks
  for item in select * from jsonb_array_elements(coalesce(p_payload -> 'creates', '[]')) loop
    insert into public.tasks (user_id, title, description, due_date, due_time, end_time, estimated_duration,
                              priority, category, energy, is_fixed, status, source, project_id, goal_id,
                              series_id, occurrence_date)
    values (uid, item ->> 'title', item ->> 'description', (item ->> 'due_date')::date,
            (item ->> 'due_time')::time, (item ->> 'end_time')::time, (item ->> 'estimated_duration')::int,
            coalesce(item ->> 'priority', 'medium'), item ->> 'category', item ->> 'energy',
            coalesce((item ->> 'is_fixed')::boolean, false), 'todo', 'ai',
            coalesce((v_milestones ->> (item ->> 'milestone_key'))::uuid, (item ->> 'project_id')::uuid),
            case when (item ->> 'new_goal')::boolean then v_goal else (item ->> 'goal_id')::uuid end,
            (v_series ->> (item ->> 'series_key'))::uuid,
            case when item ->> 'series_key' is not null then (item ->> 'occurrence_date')::date end)
    on conflict (series_id, occurrence_date) do nothing;
    get diagnostics v_rows = row_count;
    v_created := v_created + v_rows;
  end loop;

  -- Existing tasks moved to resolve a time conflict
  for item in select * from jsonb_array_elements(coalesce(p_payload -> 'moves', '[]')) loop
    update public.tasks
    set due_time = (item ->> 'due_time')::time, end_time = (item ->> 'end_time')::time
    where id = (item ->> 'id')::uuid;
    get diagnostics v_rows = row_count;
    v_updated := v_updated + v_rows;
  end loop;

  -- Changes to existing tasks (only the keys that are present change)
  for item in select * from jsonb_array_elements(coalesce(p_payload -> 'updates', '[]')) loop
    ch := coalesce(item -> 'changes', '{}');
    update public.tasks
    set title = coalesce(ch ->> 'title', title),
        due_date = case when ch ? 'due_date' then (ch ->> 'due_date')::date else due_date end,
        due_time = case when ch ? 'due_time' then (ch ->> 'due_time')::time else due_time end,
        end_time = case when ch ? 'end_time' then (ch ->> 'end_time')::time else end_time end,
        estimated_duration = case when ch ? 'estimated_duration'
                                  then (ch ->> 'estimated_duration')::int else estimated_duration end,
        status = coalesce(ch ->> 'status', status),
        priority = coalesce(ch ->> 'priority', priority)
    where id = (item ->> 'id')::uuid;
    get diagnostics v_rows = row_count;
    v_updated := v_updated + v_rows;
  end loop;

  -- Whole routines stopped or changed from a date on. Their open occurrences
  -- from that date are removed; the app recreates them from the new rule.
  for item in select * from jsonb_array_elements(coalesce(p_payload -> 'series_changes', '[]')) loop
    delete from public.tasks
    where series_id = (item ->> 'id')::uuid
      and occurrence_date >= (item ->> 'from_date')::date
      and status in ('todo', 'in_progress');

    if item ->> 'action' = 'stop' then
      update public.task_series
      set until = (item ->> 'from_date')::date - 1, updated_at = now()
      where id = (item ->> 'id')::uuid;
    else
      ch := coalesce(item -> 'changes', '{}');
      update public.task_series
      set title = coalesce(ch ->> 'title', title),
          due_time = case when ch ? 'due_time' then (ch ->> 'due_time')::time else due_time end,
          end_time = case when ch ? 'end_time' then (ch ->> 'end_time')::time else end_time end,
          estimated_duration = case when ch ? 'estimated_duration'
                                    then (ch ->> 'estimated_duration')::int else estimated_duration end,
          pattern = coalesce(ch -> 'pattern', pattern),
          -- the deletes above added exceptions; the rule changed, so start clean
          exceptions = array(select d from unnest(exceptions) d where d < (item ->> 'from_date')::date),
          updated_at = now()
      where id = (item ->> 'id')::uuid;
    end if;
    get diagnostics v_rows = row_count;
    v_updated := v_updated + v_rows;
  end loop;

  -- Deletions
  if jsonb_array_length(coalesce(p_payload -> 'deletes', '[]')) > 0 then
    delete from public.tasks
    where id in (select (jsonb_array_elements_text(p_payload -> 'deletes'))::uuid);
    get diagnostics v_deleted = row_count;
  end if;

  v_result := jsonb_build_object('created', v_created, 'updated', v_updated, 'deleted', v_deleted,
                                 'goal_id', v_goal);
  insert into public.proposal_applies (user_id, key, result) values (uid, p_key, v_result);
  return v_result;
end;
$$;

revoke execute on function public.apply_proposal(text, jsonb) from public, anon;
grant execute on function public.apply_proposal(text, jsonb) to authenticated;
