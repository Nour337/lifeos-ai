-- Fixes from the Supabase database advisor.

-- 1. rls_auto_enable is an event-trigger helper; nobody should call it over the API.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- 2. Evaluate auth.uid() once per query instead of once per row.
alter policy "Users can view their own AI usage" on public.ai_usage using ((select auth.uid()) = user_id);

alter policy "Users can view their own goals" on public.goals using ((select auth.uid()) = user_id);
alter policy "Users can insert their own goals" on public.goals with check ((select auth.uid()) = user_id);
alter policy "Users can update their own goals" on public.goals using ((select auth.uid()) = user_id);
alter policy "Users can delete their own goals" on public.goals using ((select auth.uid()) = user_id);

alter policy "Users can view their own profile" on public.profiles using ((select auth.uid()) = id);
alter policy "Users can insert their own profile" on public.profiles with check ((select auth.uid()) = id);
alter policy "Users can update their own profile" on public.profiles using ((select auth.uid()) = id);

alter policy "Users can view their own projects" on public.projects using ((select auth.uid()) = user_id);
alter policy "Users can insert their own projects" on public.projects with check ((select auth.uid()) = user_id);
alter policy "Users can update their own projects" on public.projects using ((select auth.uid()) = user_id);
alter policy "Users can delete their own projects" on public.projects using ((select auth.uid()) = user_id);

alter policy "Users can view their own tasks" on public.tasks using ((select auth.uid()) = user_id);
alter policy "Users can insert their own tasks" on public.tasks with check ((select auth.uid()) = user_id);
alter policy "Users can update their own tasks" on public.tasks using ((select auth.uid()) = user_id);
alter policy "Users can delete their own tasks" on public.tasks using ((select auth.uid()) = user_id);

-- 3. Index the foreign keys.
create index if not exists goals_user_id_idx on public.goals (user_id);
create index if not exists projects_user_id_idx on public.projects (user_id);
create index if not exists projects_goal_id_idx on public.projects (goal_id);
create index if not exists tasks_project_id_idx on public.tasks (project_id);
create index if not exists tasks_goal_id_idx on public.tasks (goal_id);
