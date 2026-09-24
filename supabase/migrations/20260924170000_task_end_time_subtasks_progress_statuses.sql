-- Applied to the Supabase project on 2026-09-24.
-- End time, subtasks (parent_id), % complete, and two new statuses.
alter table public.tasks
  add column if not exists end_time time,
  add column if not exists parent_id uuid references public.tasks(id) on delete cascade,
  add column if not exists progress int not null default 0
    check (progress between 0 and 100);

alter table public.tasks drop constraint if exists tasks_status_check;
alter table public.tasks add constraint tasks_status_check
  check (status in ('todo', 'in_progress', 'done', 'skipped', 'rescheduled'));

create index if not exists tasks_parent_id_idx on public.tasks (parent_id);
create index if not exists tasks_user_due_idx on public.tasks (user_id, due_date);
