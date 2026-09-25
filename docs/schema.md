# Database Schema Design

## Relationship Overview
Goal ← Project ← Task
A Goal can have many Projects. A Project can have many Tasks.
A Task can ALSO link directly to a Goal, bypassing Project, for
quick goal-related items that don't need a full project.

    Goal
   /    \
Project   Task (optional direct link)
   |
  Task

## Tables

### goals
| Column       | Type      | Notes                          |
|--------------|-----------|---------------------------------|
| id           | uuid      | primary key                    |
| user_id      | uuid      | owner (FK -> auth.users)       |
| name         | text      |                                 |
| description  | text      |                                 |
| target_date  | date      |                                 |
| progress     | int       | 0-100, the user's own estimate |
| why          | text      | why the goal matters            |
| priority     | text      | low / medium / high / very_high |
| weekly_hours | numeric   | hours per week the user can give |
| created_at   | timestamp |                                 |

### projects
Also holds courses (`kind = 'course'`, `deadline` = exam date) and work
(graduation project, job, freelance, business idea...), so study and work
tasks link to them through `tasks.project_id`.

| Column       | Type      | Notes                          |
|--------------|-----------|---------------------------------|
| id           | uuid      | primary key                    |
| user_id      | uuid      | owner                          |
| name         | text      |                                 |
| description  | text      |                                 |
| deadline     | date      | exam date for courses           |
| progress     | int       | 0-100, the user's own estimate  |
| goal_id      | uuid, nullable | FK -> goals.id            |
| kind         | text      | course / university / graduation / personal / freelance / business / internship / job / research / project / other |
| importance   | text      | low / medium / high / very_high |
| difficulty   | text      | easy / medium / hard (courses)  |
| weekly_hours | numeric   | hours per week                  |
| ai_help      | bool      | false = no AI suggestions for it |
| created_at   | timestamp |                                 |

### tasks
| Column             | Type      | Notes                     |
|--------------------|-----------|----------------------------|
| id                 | uuid      | primary key                |
| user_id            | uuid      | owner                      |
| title              | text      |                             |
| description        | text      |                             |
| priority           | text      | low / medium / high        |
| status             | text      | todo / in_progress / done / skipped / rescheduled |
| due_date           | date      |                             |
| due_time           | time, nullable | groups Today into morning / afternoon / evening |
| end_time           | time, nullable | end of a timed task |
| estimated_duration | int       | minutes                    |
| category           | text      |                             |
| project_id         | uuid, nullable | FK -> projects.id      |
| goal_id            | uuid, nullable | FK -> goals.id (direct link, bypasses project) |
| repeat             | text, nullable | daily / weekly / monthly; completing moves due_date forward |
| parent_id          | uuid, nullable | FK -> tasks.id (on delete cascade); set on subtasks |
| progress           | int       | 0-100; cached % of subtasks done, or set by hand |
| created_at         | timestamp |                             |

### ai_usage
| Column  | Type | Notes                                    |
|---------|------|-------------------------------------------|
| user_id | uuid | FK -> auth.users, part of primary key     |
| day     | date | UTC day, part of primary key              |
| count   | int  | AI questions used that day                |

Users can only read their row. `consume_ai_credit()` (security definer)
is the only writer and enforces the daily limit of 10.
See `supabase/migrations/`.

### profiles
| Column            | Type  | Notes                                         |
|-------------------|-------|-----------------------------------------------|
| id                | uuid  | = auth.users.id; created by a trigger on signup |
| display_name      | text  |                                               |
| ai_personality    | text  | friendly / direct / coach / professional / teacher / balanced |
| ai_profile        | jsonb | the AI persona: about (roles as a list: student + working + entrepreneur...), education, work, business, interests, skills, tools, tech stack, learning, schedule, busy blocks, preferences, habits, instructions, summary, memory, ignored suggestion areas, covered onboarding sections (see `types/persona.ts`) |
| onboarding_status | text  | pending (show onboarding) / skipped / done    |

### weekly_reviews
| Column     | Type  | Notes                                    |
|------------|-------|------------------------------------------|
| user_id    | uuid  | part of primary key                      |
| week_start | date  | Monday, part of primary key              |
| review     | jsonb | stats + AI text (`WeeklyReview` in `lib/persona/types.ts`) |

### ai_usage_extra
Counters for AI that does NOT use the 10 daily messages:
- `persona`: Persona Mode (persona chat, suggestions, "what now", planning,
  weekly reviews, subtasks) once the user has a persona
- `onboarding`: creating / updating the persona

These are "unlimited" for normal use; `consume_extra_ai_credit(kind)`
(security definer, the only writer) only enforces a fair-use ceiling
(persona 300/day, onboarding 200/day) against scripts and abuse.

## AI usage rule
- Normal AI chat: 10 messages per user per day (`consume_ai_credit`).
- Persona AI: unlimited once `personaActive(profile)` is true
  (onboarding done and the persona says who the user is).
  Without a persona, persona-powered features fall back to the 10/day.

## Key Decision Log
- Deviated from roadmap: used `projects.goal_id` instead of
  `goals.project_id`. Reasoning: a goal should support many
  projects (one-to-many), not be tied to a single project.
  This matches how real goals work (e.g. "Run a 10K" needs
  multiple efforts: training plan, gear, nutrition).