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
| progress     | int       | 0-100                          |
| created_at   | timestamp |                                 |

### projects
| Column       | Type      | Notes                          |
|--------------|-----------|---------------------------------|
| id           | uuid      | primary key                    |
| user_id      | uuid      | owner                          |
| name         | text      |                                 |
| description  | text      |                                 |
| deadline     | date      |                                 |
| progress     | int       |                                 |
| goal_id      | uuid, nullable | FK -> goals.id            |
| created_at   | timestamp |                                 |

### tasks
| Column             | Type      | Notes                     |
|--------------------|-----------|----------------------------|
| id                 | uuid      | primary key                |
| user_id            | uuid      | owner                      |
| title              | text      |                             |
| description        | text      |                             |
| priority           | text      | low / medium / high        |
| status             | text      | todo / in_progress / done  |
| due_date           | date      |                             |
| estimated_duration | int       | minutes                    |
| category           | text      |                             |
| project_id         | uuid, nullable | FK -> projects.id      |
| goal_id            | uuid, nullable | FK -> goals.id (direct link, bypasses project) |
| created_at         | timestamp |                             |

## Key Decision Log
- Deviated from roadmap: used `projects.goal_id` instead of
  `goals.project_id`. Reasoning: a goal should support many
  projects (one-to-many), not be tied to a single project.
  This matches how real goals work (e.g. "Run a 10K" needs
  multiple efforts: training plan, gear, nutrition).