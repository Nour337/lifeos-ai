-- Server-side conversations, the daily suggestions cache, push
-- notifications, and deleting your account.

-- 1. Conversations: the chat is kept on the server (any device), with a
--    rolling summary of older turns. Lasting facts live in the persona.
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text,
  summary text, -- summary of the messages before summarized_upto
  summarized_upto bigint not null default 0, -- last message id folded into the summary
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists conversations_user_updated_idx on public.conversations (user_id, updated_at desc);

create table if not exists public.messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) <= 8000),
  proposal jsonb, -- a proposed plan waiting for Apply / Discard
  proposal_state text check (proposal_state in ('pending', 'applied', 'discarded')),
  remembered jsonb, -- persona changes made in this turn, with their undo data
  created_at timestamptz not null default now()
);

create index if not exists messages_conversation_idx on public.messages (conversation_id, id);
create index if not exists messages_user_idx on public.messages (user_id);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
drop policy if exists "Users manage their own conversations" on public.conversations;
drop policy if exists "Users manage their own messages" on public.messages;
create policy "Users manage their own conversations" on public.conversations
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users manage their own messages" on public.messages
  for all using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = (select auth.uid()))
  );
grant select, insert, update, delete on public.conversations, public.messages to authenticated;

-- 2. Suggestions are made once a day per user (any device), and made again
--    only when the user's data has changed (hash)
create table if not exists public.daily_suggestions (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day date not null,
  hash text not null,
  items jsonb not null default '[]',
  handled jsonb not null default '[]',
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.daily_suggestions enable row level security;
drop policy if exists "Users manage their own suggestions" on public.daily_suggestions;
create policy "Users manage their own suggestions" on public.daily_suggestions
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.daily_suggestions to authenticated;

-- 3. Notifications
alter table public.profiles
  add column if not exists notify jsonb not null default
    '{"enabled": false, "reminder_minutes": 10, "morning": "07:30", "evening": "21:00",
      "weekly_review": true, "deadlines": true, "quiet_start": "23:00", "quiet_end": "07:00"}'::jsonb;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
drop policy if exists "Users manage their own push subscriptions" on public.push_subscriptions;
create policy "Users manage their own push subscriptions" on public.push_subscriptions
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- What was sent, so nothing is sent twice
create table if not exists public.notification_log (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  ref text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, kind, ref)
);

alter table public.notification_log enable row level security;
drop policy if exists "Users can view their own notifications" on public.notification_log;
create policy "Users can view their own notifications" on public.notification_log
  for select using ((select auth.uid()) = user_id);
revoke all on public.notification_log from anon, authenticated;
grant select on public.notification_log to authenticated;

-- Secrets that only security-definer functions can read. The cron secret
-- is inserted outside migrations (never commit it):
--   insert into private.settings values ('cron_secret', '<CRON_SECRET>');
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.settings (
  key text primary key,
  value text not null
);

-- Called by /api/cron/notify every few minutes with the cron secret.
-- Returns the notifications due now, each with the user's push
-- subscriptions, and records them so they are never sent twice.
create or replace function public.get_due_notifications(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out jsonb := '[]';
  r record;
  t record;
  v_local timestamp;
  v_today date;
  v_time time;
  v_subs jsonb;
  v_morning time;
  v_evening time;
  v_quiet_start time;
  v_quiet_end time;
  v_quiet boolean;
  v_open int;
  v_first record;
  v_days int;
begin
  if p_secret is null or p_secret is distinct from (select s.value from private.settings s where s.key = 'cron_secret') then
    raise exception 'forbidden';
  end if;

  for r in
    select p.id, p.timezone, p.notify
    from public.profiles p
    where coalesce((p.notify ->> 'enabled')::boolean, false)
      and exists (select 1 from public.push_subscriptions s where s.user_id = p.id)
  loop
    v_local := now() at time zone r.timezone;
    v_today := v_local::date;
    v_time := v_local::time;
    v_morning := coalesce(nullif(r.notify ->> 'morning', '')::time, '07:30');
    v_evening := coalesce(nullif(r.notify ->> 'evening', '')::time, '21:00');
    v_quiet_start := coalesce(nullif(r.notify ->> 'quiet_start', '')::time, '23:00');
    v_quiet_end := coalesce(nullif(r.notify ->> 'quiet_end', '')::time, '07:00');
    v_quiet := case when v_quiet_start > v_quiet_end
                    then v_time >= v_quiet_start or v_time < v_quiet_end
                    else v_time >= v_quiet_start and v_time < v_quiet_end end;

    select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
    into v_subs
    from public.push_subscriptions s where s.user_id = r.id;

    -- Task reminders (not in quiet hours)
    if not v_quiet then
      -- (tomorrow too: a 00:15 task is reminded before midnight)
      for t in
        select k.id, k.title, k.due_time, k.due_date
        from public.tasks k
        where k.user_id = r.id and k.parent_id is null and k.due_date in (v_today, v_today + 1)
          and k.due_time is not null
          and k.status in ('todo', 'in_progress')
          and (k.due_date + k.due_time) - make_interval(mins => coalesce((r.notify ->> 'reminder_minutes')::int, 10)) <= v_local
          and (k.due_date + k.due_time) > v_local - interval '10 minutes'
      loop
        insert into public.notification_log (user_id, kind, ref)
        values (r.id, 'reminder', t.id::text || ':' || t.due_date)
        on conflict do nothing;
        if found then
          v_out := v_out || jsonb_build_array(jsonb_build_object(
            'user_id', r.id, 'subs', v_subs, 'kind', 'reminder', 'url', '/dashboard',
            'title', t.title, 'body', 'Starts at ' || to_char(t.due_time, 'HH24:MI')));
        end if;
      end loop;
    end if;

    -- Morning brief
    if v_time >= v_morning and v_time < v_morning + interval '3 hours' then
      select count(*) into v_open from public.tasks k
      where k.user_id = r.id and k.parent_id is null and k.due_date = v_today and k.status in ('todo', 'in_progress');
      select k.title, k.due_time into v_first from public.tasks k
      where k.user_id = r.id and k.parent_id is null and k.due_date = v_today and k.due_time is not null
        and k.status in ('todo', 'in_progress')
      order by k.due_time limit 1;
      insert into public.notification_log (user_id, kind, ref) values (r.id, 'morning', v_today::text)
      on conflict do nothing;
      if found then
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'user_id', r.id, 'subs', v_subs, 'kind', 'morning', 'url', '/dashboard',
          'title', 'Good morning ☀️',
          'body', case when v_open = 0 then 'Nothing planned today yet. Open LifeOS to plan your day.'
                       else v_open || ' task' || case when v_open = 1 then '' else 's' end || ' today'
                            || coalesce(', first: ' || v_first.title || ' at ' || to_char(v_first.due_time, 'HH24:MI'), '')
                            || '.' end));
      end if;

      -- Deadline countdowns: 14, 7, 3 and 1 days before
      if coalesce((r.notify ->> 'deadlines')::boolean, true) then
        for t in
          select p.id, p.name as title, p.deadline as due from public.projects p
          where p.user_id = r.id and p.kind <> 'milestone' and p.deadline - v_today in (14, 7, 3, 1)
          union all
          select a.id, a.title, a.due_date from public.assessments a
          where a.user_id = r.id and not a.done and a.due_date - v_today in (14, 7, 3, 1)
          union all
          select g.id, g.name, g.target_date from public.goals g
          where g.user_id = r.id and g.target_date - v_today in (14, 7, 3, 1)
        loop
          v_days := t.due - v_today;
          insert into public.notification_log (user_id, kind, ref)
          values (r.id, 'deadline', t.id::text || ':' || v_days)
          on conflict do nothing;
          if found then
            v_out := v_out || jsonb_build_array(jsonb_build_object(
              'user_id', r.id, 'subs', v_subs, 'kind', 'deadline', 'url', '/dashboard',
              'title', t.title || ' in ' || v_days || ' day' || case when v_days = 1 then '' else 's' end,
              'body', 'Open LifeOS to see what to do next for it.'));
          end if;
        end loop;
      end if;
    end if;

    -- Evening check-in (only when something is still open today)
    if v_time >= v_evening and v_time < v_evening + interval '2 hours' then
      select count(*) into v_open from public.tasks k
      where k.user_id = r.id and k.parent_id is null and k.due_date = v_today and k.status in ('todo', 'in_progress');
      if v_open > 0 then
        insert into public.notification_log (user_id, kind, ref) values (r.id, 'evening', v_today::text)
        on conflict do nothing;
        if found then
          v_out := v_out || jsonb_build_array(jsonb_build_object(
            'user_id', r.id, 'subs', v_subs, 'kind', 'evening', 'url', '/dashboard',
            'title', 'How did today go?',
            'body', v_open || ' task' || case when v_open = 1 then ' is' else 's are' end
                    || ' still open. Take 30 seconds to check them off or move them.'));
        end if;
      end if;
    end if;

    -- Weekly review: Sunday evening
    if coalesce((r.notify ->> 'weekly_review')::boolean, true)
       and extract(isodow from v_today) = 7 and v_time >= v_evening - interval '1 hour' then
      insert into public.notification_log (user_id, kind, ref) values (r.id, 'review', v_today::text)
      on conflict do nothing;
      if found then
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'user_id', r.id, 'subs', v_subs, 'kind', 'review', 'url', '/review',
          'title', 'Your week in review',
          'body', 'See what you finished, what slipped, and plan next week.'));
      end if;
    end if;
  end loop;

  return v_out;
end;
$$;

-- Expired subscriptions (the push service answered 404 / 410)
create or replace function public.remove_push_subscription(p_secret text, p_endpoint text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_secret is null or p_secret is distinct from (select s.value from private.settings s where s.key = 'cron_secret') then
    raise exception 'forbidden';
  end if;
  delete from public.push_subscriptions where endpoint = p_endpoint;
end;
$$;

revoke execute on function public.get_due_notifications(text) from public;
revoke execute on function public.remove_push_subscription(text, text) from public;
grant execute on function public.get_due_notifications(text) to anon, authenticated;
grant execute on function public.remove_push_subscription(text, text) to anon, authenticated;

-- 4. Delete my account: removes the user; every table cascades from auth.users
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
