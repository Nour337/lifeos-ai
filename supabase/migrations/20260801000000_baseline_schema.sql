-- Baseline: the original tables, as they existed before the dated migrations
-- below. They were first created in the Supabase dashboard; this file lets a
-- fresh database (local, staging, a branch) be rebuilt from the repository.
-- Later migrations add columns with "add column if not exists", so this file
-- only holds the original columns. Safe to re-run: everything is guarded.
-- NOT applied to the live project (the objects already exist there).

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  name text not null,
  description text,
  target_date date,
  progress int default 0,
  created_at timestamptz default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  name text not null,
  description text,
  deadline date,
  goal_id uuid references public.goals (id) on delete set null,
  created_at timestamptz default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  title text not null,
  description text,
  priority text default 'medium',
  status text default 'todo',
  due_date date,
  estimated_duration int,
  category text,
  project_id uuid references public.projects (id) on delete set null,
  goal_id uuid references public.goals (id) on delete set null,
  created_at timestamptz default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  ai_personality text,
  created_at timestamptz default now()
);

alter table public.goals enable row level security;
alter table public.projects enable row level security;
alter table public.tasks enable row level security;
alter table public.profiles enable row level security;

-- Owner-only policies (20260925120000_advisor_fixes.sql rewrites them to the
-- faster "(select auth.uid())" form)
do $$
declare
  t text;
begin
  foreach t in array array['goals', 'projects', 'tasks'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t
                   and policyname = format('Users can view their own %s', t)) then
      execute format('create policy "Users can view their own %1$s" on public.%1$s for select using (auth.uid() = user_id)', t);
      execute format('create policy "Users can insert their own %1$s" on public.%1$s for insert with check (auth.uid() = user_id)', t);
      execute format('create policy "Users can update their own %1$s" on public.%1$s for update using (auth.uid() = user_id)', t);
      execute format('create policy "Users can delete their own %1$s" on public.%1$s for delete using (auth.uid() = user_id)', t);
    end if;
  end loop;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles'
                 and policyname = 'Users can view their own profile') then
    create policy "Users can view their own profile" on public.profiles for select using (auth.uid() = id);
    create policy "Users can insert their own profile" on public.profiles for insert with check (auth.uid() = id);
    create policy "Users can update their own profile" on public.profiles for update using (auth.uid() = id);
  end if;
end $$;

-- The hosted project has a platform helper public.rls_auto_enable() that a
-- later migration locks down; create a stand-in so a fresh rebuild works.
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'rls_auto_enable'
                 and pronamespace = 'public'::regnamespace) then
    execute 'create function public.rls_auto_enable() returns event_trigger language plpgsql as $f$ begin end $f$';
  end if;
end $$;

grant select, insert, update, delete on public.goals, public.projects, public.tasks to authenticated;
grant select, insert, update on public.profiles to authenticated;
