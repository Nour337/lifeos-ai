-- Notifications scheduler: run once in the Supabase SQL editor after
-- deploying (NOT a migration: it contains your secret and your URL).
-- Replace the two placeholders first.
--
-- 1. The secret the database checks (same value as CRON_SECRET in the app)
insert into private.settings (key, value)
values ('cron_secret', '<CRON_SECRET>')
on conflict (key) do update set value = excluded.value;

-- 2. Call /api/cron/notify every 5 minutes (pg_cron + pg_net)
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('lifeos-notify') where exists (select 1 from cron.job where jobname = 'lifeos-notify');
-- (the secret is read from private.settings, so it isn't copied into the job)
select cron.schedule(
  'lifeos-notify',
  '*/5 * * * *',
  $$
  select net.http_get(
    url := 'https://<YOUR-APP-DOMAIN>/api/cron/notify',
    headers := jsonb_build_object('Authorization',
      'Bearer ' || (select value from private.settings where key = 'cron_secret'))
  );
  $$
);

-- Any other scheduler works too (Vercel Cron on a paid plan, an uptime
-- pinger...): a GET to /api/cron/notify with that Authorization header.
