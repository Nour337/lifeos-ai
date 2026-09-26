# LifeOS AI

An AI planner for people with several roles at once (student, working,
entrepreneur). You tell it what you want in plain language; it proposes a
plan you can apply, knows your persona (courses, exams, work hours,
routines, goals), and learns from what you actually do.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill it in.
3. Apply the database migrations in `supabase/migrations/` in order
   (`supabase db push`, or paste them into the SQL editor). The first file,
   `20260801000000_baseline_schema.sql`, rebuilds the original tables on a
   fresh database; skip it on a project that already has them.
4. For notifications, run `supabase/cron_notifications.sql` once (after
   deploying) with your secret and URL.
5. `npm run dev` and open http://localhost:3000

## How it fits together

- `lib/schedule.ts`: the one scheduling engine (busy hours, overnight
  shifts, semesters, rest days, capacity, conflicts, free slots).
- `lib/series.ts`: routines and repeating tasks (a rule + its sessions).
- `lib/assistant/`: the AI assistant — context, tools, proposals, persona
  updates (with undo), free answers for simple questions, and server-side
  conversations with summaries.
- `lib/persona/`: the persona, insights learned from task history,
  suggestions (scored in code, worded by the AI), "what now", weekly review,
  and the quick-start onboarding.
- `lib/ai/`: the OpenAI client (retries, token logging) and the AI points
  budget (`consume_ai` / `finish_ai` in the database; failures are refunded).
- `docs/schema.md`: the database.

AI costs points from a daily allowance; everything that doesn't need a
model (reminders, recovery, study plans, simple questions) is free.
