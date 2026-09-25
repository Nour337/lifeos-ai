-- Persona Mode: once a user has an AI persona, persona-powered AI
-- (persona chat, suggestions, planning, reviews, onboarding) doesn't use the
-- 10 daily AI messages. A high fair-use ceiling stays in place only to stop
-- runaway scripts or abuse from running up the OpenAI bill.

alter table public.ai_usage_extra drop constraint if exists ai_usage_extra_kind_check;
alter table public.ai_usage_extra
  add constraint ai_usage_extra_kind_check
    check (kind in ('onboarding', 'persona', 'suggest', 'review'));

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

  -- Fair-use ceilings (normal use never gets near them)
  daily_limit := case credit_kind
    when 'onboarding' then 200
    when 'persona' then 300
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

-- Roles are a list now (student + working + entrepreneur...): convert the
-- old single "occupation" into "roles"
update public.profiles
set ai_profile = jsonb_set(
  ai_profile #- '{about,occupation}',
  '{about,roles}',
  jsonb_build_array(
    case ai_profile #>> '{about,occupation}'
      when 'employee' then 'working'
      else ai_profile #>> '{about,occupation}'
    end
  )
)
where ai_profile #>> '{about,occupation}' is not null
  and ai_profile #> '{about,roles}' is null;
