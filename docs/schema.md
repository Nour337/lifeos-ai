# Database Schema Design

All tables live in `public`, have row level security on, and only let a
user see and change their own rows. The full definitions are in
`supabase/migrations/` (the first file rebuilds the original tables).

## Relationship Overview

    Goal
   /  |  \
Project  Milestone (projects.kind = 'milestone')   Task (direct link)
   |        |
  Task     Task
   |
 Assessment (courses: exams, quizzes, assignments)

    Series (routine / repeating task) ── occurrences are Tasks (series_id)

A Task can link to a Goal directly, bypassing Project, for quick
goal-related items. Courses are projects with `kind = 'course'`.

## Tables

### goals
| Column          | Type      | Notes                                           |
|-----------------|-----------|-------------------------------------------------|
| id              | uuid      | primary key                                     |
| user_id         | uuid      | owner (FK -> auth.users)                        |
| name            | text      |                                                 |
| description     | text      |                                                 |
| target_date     | date      |                                                 |
| progress        | int       | 0-100, used only when `progress_manual`         |
| progress_manual | bool      | false = calculated from tasks and milestones    |
| why             | text      | why the goal matters                            |
| priority        | text      | low / medium / high / very_high                 |
| weekly_hours    | numeric   | hours per week the user can give                |
| created_at      | timestamp |                                                 |

### projects
Holds projects, courses (`kind = 'course'`), work (graduation project, job,
freelance, business idea...) and the milestones of a goal
(`kind = 'milestone'`, shown under the goal, not in the Projects list).

| Column          | Type           | Notes                                    |
|-----------------|----------------|------------------------------------------|
| id              | uuid           | primary key                              |
| user_id         | uuid           | owner                                    |
| name            | text           |                                          |
| description     | text           |                                          |
| deadline        | date           | for courses: when the course ends        |
| goal_id         | uuid, nullable | FK -> goals.id                           |
| kind            | text           | course / university / graduation / personal / freelance / business / internship / job / research / project / milestone / other |
| importance      | text           | low / medium / high / very_high          |
| difficulty      | text           | easy / medium / hard (courses)           |
| weekly_hours    | numeric        | hours per week                           |
| progress        | int            | 0-100, used only when `progress_manual`  |
| progress_manual | bool           | false = calculated from its tasks        |
| ai_help         | bool           | false = no AI suggestions for it         |
| created_at      | timestamp      |                                          |

### assessments
Exams, quizzes and assignments of a course.

| Column     | Type    | Notes                                                       |
|------------|---------|-------------------------------------------------------------|
| id         | uuid    | primary key                                                 |
| user_id    | uuid    | owner                                                       |
| project_id | uuid    | the course (FK -> projects.id, on delete cascade)           |
| type       | text    | exam / midterm / final / quiz / assignment / presentation / other |
| title      | text    |                                                             |
| due_date   | date    |                                                             |
| due_time   | time    | optional                                                    |
| weight     | numeric | % of the grade                                              |
| done       | bool    |                                                             |

### tasks
| Column             | Type           | Notes                                       |
|--------------------|----------------|---------------------------------------------|
| id                 | uuid           | primary key                                 |
| user_id            | uuid           | owner                                       |
| title              | text           |                                             |
| description        | text           |                                             |
| priority           | text           | low / medium / high / very_high             |
| status             | text           | todo / in_progress / done / skipped (a move is an event, not a status) |
| due_date           | date           |                                             |
| due_time           | time, nullable | start; groups Today into morning / afternoon / evening |
| end_time           | time, nullable | end of a timed task                         |
| estimated_duration | int            | minutes                                     |
| category           | text           |                                             |
| energy             | text, nullable | deep / light                                |
| is_fixed           | bool           | an appointment the planner never moves      |
| source             | text           | user / ai / suggestion / system             |
| project_id         | uuid, nullable | FK -> projects.id                           |
| goal_id            | uuid, nullable | FK -> goals.id (direct link)                |
| parent_id          | uuid, nullable | FK -> tasks.id (on delete cascade); subtasks |
| progress           | int            | 0-100; % of subtasks done, or set by hand   |
| series_id          | uuid, nullable | FK -> task_series.id: an occurrence of a routine |
| occurrence_date    | date, nullable | the day the series scheduled it (unique per series) |
| started_at         | timestamptz    | set by a trigger when it goes in progress   |
| completed_at       | timestamptz    | set by a trigger when it's done             |
| created_at         | timestamp      |                                             |

### task_series
A routine or repeating task. Its occurrences are task rows, created 28 days
ahead by the app (`lib/series.ts`). Deleting an occurrence adds its date to
`exceptions` (trigger), so it isn't created again.

| Column             | Type    | Notes                                             |
|--------------------|---------|---------------------------------------------------|
| id                 | uuid    | primary key                                       |
| user_id            | uuid    | owner                                             |
| title, description | text    |                                                   |
| pattern            | jsonb   | daily / weekdays / weekends / days_of_week / every_n_days / on_off / monthly (`lib/assistant/patterns.ts`) |
| start_date         | date    | the pattern's anchor                              |
| until              | date    | last day (null = ongoing); stopping sets it       |
| count              | int     | number of sessions, if limited                    |
| due_time, end_time, estimated_duration, priority, category, energy, project_id, goal_id | | copied to each occurrence |
| is_routine         | bool    | a habit (streaks) vs. repeating work              |
| exceptions         | date[]  | skipped days                                      |

### task_events
What actually happened, written by a trigger on `tasks`: created, moved,
started, completed, reopened, skipped, deleted — with from/to date and time
and the source (user / ai / system). Insights and weekly reviews are built
from it. Read-only for users.

### profiles
| Column            | Type  | Notes                                         |
|-------------------|-------|-----------------------------------------------|
| id                | uuid  | = auth.users.id; created by a trigger on signup |
| display_name      | text  |                                               |
| ai_personality    | text  | friendly / direct / coach / professional / teacher / balanced |
| ai_profile        | jsonb | the AI persona (`types/persona.ts`): roles (a list: student + working + entrepreneur...), education (incl. semester and exam period), work (employment type, days off, commute), business (stage), interests, skills (have / learning / want), schedule (wake, sleep, capacity, rest days), preferences (durations, language, time split per role), busy blocks (overnight and semester-limited, optionally a course's lectures), instructions, summary, memory (category, pinned, expiry), ignored suggestion areas (fading), covered onboarding sections. Capped at 64 KB. |
| onboarding_status | text  | pending (show the quick start) / skipped / done |
| timezone          | text  | IANA name; the server's "today" and AI points follow it |
| notify            | jsonb | notification settings (`NotifySettings`)       |

### entitlements
The daily AI allowance (`daily_points`, default 30) and plan. Users can read
their row but never write it.

### ai_usage / ai_calls
`ai_usage` is points used per user per (user-local) day. `ai_calls` logs
every AI request: kind, cost, status (reserved / ok / failed), model, tokens,
latency. Both are written only by `consume_ai()` / `finish_ai()`.

### conversations / messages
The assistant chat, stored on the server. `conversations.summary` holds a
summary of messages up to `summarized_upto`; messages keep the proposal
(and whether it was applied) and any persona changes made in that turn
(with their undo data).

### daily_suggestions
Today's suggestions per user, with a hash of what they depend on (areas,
deadlines, skills) so they're only made again when that changes.

### weekly_reviews
| Column     | Type  | Notes                                     |
|------------|-------|-------------------------------------------|
| user_id    | uuid  | part of primary key                       |
| week_start | date  | Monday, part of primary key               |
| review     | jsonb | stats + AI text (`WeeklyReview` in `lib/persona/types.ts`) |

### push_subscriptions / notification_log
Web push addresses per device, and what was sent (so nothing is sent twice).

### proposal_applies
One row per applied AI proposal (its id), so applying twice does nothing.

## Functions
- `consume_ai(kind)` → reserves the points for one AI request (costs in
  `lib/ai/budget.ts`); enforces the daily allowance, a 10-a-minute burst
  limit, and daily ceilings for free kinds. `finish_ai(call_id, ok, ...)`
  settles it: a failed call gets its points back. `get_ai_budget()` for the screens.
- `apply_proposal(key, payload)` → saves an approved AI plan in one
  transaction as the user (row level security applies), once per key.
- `skip_missed_occurrences(before)` → marks missed routine sessions skipped.
- `get_due_notifications(secret)` / `remove_push_subscription(secret, endpoint)`
  → used by `/api/cron/notify`; the secret is in `private.settings`.
- `delete_my_account()` → deletes the user; everything cascades.

## AI usage rule
One budget for everyone (the persona is context, not a tier): each AI
request costs points (chat 1, what now 1, suggestions 1, steps 1, weekly
review 2; onboarding and summaries are free). Anything that doesn't need a
model is free: simple questions, reminders, the morning brief, the evening
check-in, missed-task recovery, exam study plans, applying plans.

## Key Decision Log
- `projects.goal_id` instead of `goals.project_id`: a goal can have many
  projects (one-to-many).
- Routines are series with materialized occurrences (not one task that
  moves forward): each session is recorded, so history, streaks and
  reviews are real.
- Status no longer includes "rescheduled": moves are events.
