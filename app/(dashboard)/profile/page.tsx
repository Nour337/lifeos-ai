"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { getProfile, saveProfile } from "@/lib/queries/persona";
import { getProjects } from "@/lib/queries/projects";
import { getGoals } from "@/lib/queries/goals";
import { getTasks } from "@/lib/queries/tasks";
import { computeInsights } from "@/lib/persona/insights";
import { sectionStatus } from "@/lib/persona/sections";
import { expandPattern } from "@/lib/assistant/patterns";
import { notifyTasksChanged } from "@/lib/QuickAdd";
import { useToast } from "@/components/Toast";
import ProjectForm from "@/components/ProjectForm";
import GoalForm from "@/components/GoalForm";
import {
  AboutForm,
  BlockForm,
  FieldsForm,
  HabitForm,
  InstructionsForm,
  InterestsForm,
  ListsForm,
  ScheduleForm,
  type AboutValues,
  type ScheduleValues,
} from "@/components/ProfileForms";
import { Button, ErrorState, Modal, Skeleton } from "@/components/ui";
import { BrainIcon, PencilIcon, PlusIcon, SparklesIcon, TrashIcon } from "@/components/icons";
import { formatDate, minutesToTime, timeToMinutes, toLocalDateString } from "@/utils/date";
import {
  AI_STYLES,
  describeDays,
  describePattern,
  IMPORTANCE_LABELS,
  newId,
  personaActive,
  roleOf,
  SECTIONS,
  styleOf,
  type AIProfile,
  type AIStyle,
  type BusyBlock,
  type Habit,
  type Profile,
} from "@/types/persona";
import { kindOf, type Project, type ProjectKind } from "@/types/project";
import type { Goal } from "@/types/goal";
import type { Task } from "@/types/task";

type Editing =
  | { kind: "about" }
  | { kind: "education" }
  | { kind: "work" }
  | { kind: "business" }
  | { kind: "skills" }
  | { kind: "interests" }
  | { kind: "schedule" }
  | { kind: "instructions" }
  | { kind: "habit"; habit: Habit | null }
  | { kind: "block"; block: BusyBlock | null }
  | { kind: "project"; project: Project | null; defaultKind: ProjectKind }
  | { kind: "goal"; goal: Goal | null };

const EDIT_TITLES: Record<Editing["kind"], string> = {
  about: "About me",
  education: "Education",
  work: "Work",
  business: "Business",
  skills: "Skills & learning",
  interests: "Interests",
  schedule: "Schedule & preferences",
  instructions: "Custom instructions",
  habit: "Routine",
  block: "Busy hours",
  project: "Course or project",
  goal: "Goal",
};

const EDUCATION_FIELDS = [
  { key: "university", label: "University", placeholder: "e.g. Cairo University" },
  { key: "faculty", label: "Faculty", placeholder: "e.g. Faculty of Engineering" },
  { key: "major", label: "Major", placeholder: "e.g. Computer Engineering" },
  { key: "term", label: "Current year / term", placeholder: "e.g. Last term" },
  { key: "graduation", label: "Graduation date", placeholder: "e.g. June 2027" },
] as const;

const WORK_FIELDS = [
  { key: "job", label: "Job", placeholder: "e.g. Junior developer" },
  { key: "company", label: "Company or business", placeholder: "e.g. Acme" },
  { key: "hours", label: "Working hours", placeholder: "e.g. Sun–Thu 16:00–22:00" },
  { key: "responsibilities", label: "Responsibilities", placeholder: "What you do at work", long: true },
] as const;

const SKILL_LISTS = [
  { key: "skills", label: "Skills you want to develop", placeholder: "e.g. Sales, Python" },
  { key: "tools", label: "Tools you want to learn", placeholder: "e.g. n8n, Make" },
  { key: "tech_stack", label: "Technologies you use", placeholder: "e.g. React, Excel" },
  { key: "learning", label: "Courses or topics you want to take", placeholder: "e.g. AI agents course" },
] as const;

const BUSINESS_LISTS = [
  { key: "ideas", label: "Business ideas", placeholder: "e.g. AI automation agency for clinics" },
  { key: "interests", label: "Business interests", placeholder: "e.g. SaaS, e-commerce" },
] as const;

export default function PersonaPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [saving, setSaving] = useState(false);
  const [memoryText, setMemoryText] = useState("");

  const refresh = useCallback(() => {
    if (!user) return;
    Promise.all([getProfile(user.id), getProjects(), getGoals(), getTasks().catch(() => [] as Task[])])
      .then(([p, pr, g, t]) => {
        setProfile(p);
        setProjects(pr);
        setGoals(g);
        setTasks(t);
        setLoadError("");
      })
      .catch((e: Error) => setLoadError(e.message));
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const insights = useMemo(() => computeInsights(tasks, toLocalDateString()), [tasks]);

  // Save part of the persona, then show the saved version
  const save = async (
    changes: { display_name?: string | null; ai_personality?: AIStyle; ai_profile?: AIProfile },
    message = "Saved. Your AI will use this from now on."
  ) => {
    if (!user || !profile) return false;
    setSaving(true);
    const ok = await saveProfile(user.id, changes);
    setSaving(false);
    if (!ok) {
      toast("Couldn't save. Try again.", { tone: "error" });
      return false;
    }
    setProfile({ ...profile, ...changes } as Profile);
    setEditing(null);
    toast(message);
    return true;
  };

  const updateAI = (patch: Partial<AIProfile>, message?: string) =>
    profile && save({ ai_profile: { ...profile.ai_profile, ...patch } }, message);

  const addHabitToCalendar = async (habit: Habit) => {
    if (!user) return;
    const dates = expandPattern(habit.pattern, toLocalDateString(), { count: null, until: null });
    if (!confirm(`Add "${habit.name}" to your calendar for the next 4 weeks (${dates.length} sessions)?`)) return;
    const end =
      habit.time && habit.duration ? minutesToTime(timeToMinutes(habit.time) + habit.duration) : null;
    const { error } = await supabase.from("tasks").insert(
      dates.map((date) => ({
        user_id: user.id,
        title: habit.name,
        status: "todo",
        priority: "medium",
        due_date: date,
        due_time: habit.time,
        end_time: end && end > habit.time! ? end : null,
        estimated_duration: habit.duration,
        category: habit.name,
      }))
    );
    if (error) {
      toast("Couldn't add the sessions. Try again.", { tone: "error" });
      return;
    }
    notifyTasksChanged();
    toast(`Added ${dates.length} “${habit.name}” sessions to your calendar`);
  };

  if (loadError) return <ErrorState message={loadError} onRetry={refresh} />;
  if (!profile) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    );
  }

  const ai = profile.ai_profile;
  const active = personaActive(profile);
  const courses = projects.filter((p) => p.kind === "course");
  const work = projects.filter((p) => p.kind !== "course");
  const status = sectionStatus(ai, projects, goals);
  const done = Object.values(status).filter(Boolean).length;
  const style = styleOf(profile.ai_personality);
  const name = profile.display_name ?? user?.email?.split("@")[0] ?? "You";
  const ignoredAreas = Object.entries(ai.ignored).filter(([, n]) => n > 0);
  const openProject = (project: Project | null, defaultKind: ProjectKind) =>
    setEditing({ kind: "project", project, defaultKind });

  // Summary chips: roles, then main interests, then goals
  const chips = [
    ...ai.about.roles.map((r) => `${roleOf(r).emoji} ${roleOf(r).label}`),
    ...ai.interests.slice(0, 3).map((i) => `💡 ${i}`),
    ...goals.slice(0, 3).map((g) => `🎯 ${g.name}`),
  ];

  return (
    <div className="space-y-5">
      {/* Summary */}
      <section className="overflow-hidden rounded-2xl bg-hero p-5 text-hero-ink shadow-card">
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-grad-from to-grad-to text-2xl font-bold text-white">
            {name.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider opacity-60">My AI Persona</p>
            <h1 className="truncate text-2xl font-bold tracking-tight">{name}</h1>
            {ai.about.headline && <p className="truncate text-sm opacity-75">{ai.about.headline}</p>}
          </div>
        </div>

        {chips.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <span key={c} className="rounded-full bg-white/10 px-3 py-1 text-sm">
                {c}
              </span>
            ))}
          </div>
        )}

        <div
          className={`mt-4 flex items-center gap-3 rounded-xl px-3 py-2.5 ${
            active ? "bg-ok/20" : "bg-white/10"
          }`}
        >
          <BrainIcon className="h-5 w-5 shrink-0" />
          <div className="min-w-0 flex-1 text-sm">
            {active ? (
              <>
                <p className="font-semibold">Persona Active ✓</p>
                <p className="opacity-75">Unlimited Persona AI: planning, suggestions and the Persona chat don&apos;t use your 10 daily messages.</p>
              </>
            ) : (
              <>
                <p className="font-semibold">Persona not active yet</p>
                <p className="opacity-75">Finish your persona to unlock unlimited Persona AI.</p>
              </>
            )}
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2 text-sm">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/15">
            <div
              className="h-full rounded-full bg-gradient-to-r from-grad-from to-grad-to transition-all"
              style={{ width: `${(done / SECTIONS.length) * 100}%` }}
            />
          </div>
          <span className="opacity-75">
            {done}/{SECTIONS.length} known
          </span>
        </div>

        <Link
          href={active ? "/onboarding?mode=update" : "/onboarding"}
          className="mt-4 flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-grad-from to-grad-to font-semibold text-white shadow-lg shadow-black/20 transition hover:brightness-110"
        >
          <SparklesIcon className="h-4 w-4" />
          {active ? "Update my persona" : "Create my persona"}
        </Link>
      </section>

      <Section title="How your AI sees you" emoji="🧠">
        {ai.summary.length ? (
          <ul className="space-y-1.5">
            {ai.summary.map((line) => (
              <li key={line} className="flex gap-2 text-ink">
                <span className="text-accent">•</span>
                {line}
              </li>
            ))}
          </ul>
        ) : (
          <Empty text="Your AI writes a short summary of you when your persona is created." />
        )}
        <p className="mt-3 text-xs text-muted">
          Your persona isn&apos;t fixed. Edit anything below, or just tell the Persona chat what changed (“I started working”).
        </p>
      </Section>

      <Section title="About me" emoji="👋" onEdit={() => setEditing({ kind: "about" })}>
        <Facts
          items={[
            ["Name", profile.display_name],
            ["Roles", ai.about.roles.map((r) => `${roleOf(r).emoji} ${roleOf(r).label}`).join("  ")],
            ["Who I am", ai.about.headline],
            ["Age range", ai.about.age_range],
          ]}
        />
      </Section>

      <Section title="Education" emoji="🎓" onEdit={() => setEditing({ kind: "education" })}>
        <Facts
          items={[
            ["University", ai.education.university],
            ["Faculty", ai.education.faculty],
            ["Major", ai.education.major],
            ["Year / term", ai.education.term],
            ["Graduation", ai.education.graduation],
          ]}
        />
      </Section>

      <Section
        title="Courses & exams"
        emoji="📚"
        action={<AddButton label="Add course" onClick={() => openProject(null, "course")} />}
      >
        {courses.length ? (
          <ItemList
            items={courses.map((c) => ({
              key: c.id,
              title: c.name,
              meta: [
                c.deadline && `Exam ${formatDate(c.deadline)}`,
                c.importance && `${IMPORTANCE_LABELS[c.importance]} importance`,
                c.weekly_hours && `${c.weekly_hours}h/week`,
                !c.ai_help && "No AI suggestions",
              ],
              progress: c.progress,
              onEdit: () => openProject(c, "course"),
            }))}
          />
        ) : (
          <Empty text="No courses yet." />
        )}
      </Section>

      <Section title="Work" emoji="💼" onEdit={() => setEditing({ kind: "work" })}>
        <Facts
          items={[
            ["Job", ai.work.job],
            ["Company", ai.work.company],
            ["Hours", ai.work.hours],
            ["Responsibilities", ai.work.responsibilities],
          ]}
        />
      </Section>

      <Section
        title="Projects"
        emoji="🛠️"
        action={<AddButton label="Add" onClick={() => openProject(null, "project")} />}
      >
        {work.length ? (
          <ItemList
            items={work.map((p) => ({
              key: p.id,
              title: `${kindOf(p.kind).emoji} ${p.name}`,
              meta: [
                kindOf(p.kind).label,
                p.deadline && `Due ${formatDate(p.deadline)}`,
                p.importance && `${IMPORTANCE_LABELS[p.importance]} importance`,
                p.weekly_hours && `${p.weekly_hours}h/week`,
              ],
              progress: p.progress,
              onEdit: () => openProject(p, p.kind),
            }))}
          />
        ) : (
          <Empty text="Graduation project, work projects, freelance clients, your business…" />
        )}
      </Section>

      <Section title="Business" emoji="🚀" onEdit={() => setEditing({ kind: "business" })}>
        {ai.business.ideas.length || ai.business.interests.length ? (
          <div className="space-y-3">
            {ai.business.ideas.length > 0 && <Chips label="Ideas" values={ai.business.ideas} />}
            {ai.business.interests.length > 0 && <Chips label="Interested in" values={ai.business.interests} />}
          </div>
        ) : (
          <Empty text="Business ideas and what kind of business interests you." />
        )}
      </Section>

      <Section title="Skills & learning" emoji="🧩" onEdit={() => setEditing({ kind: "skills" })}>
        {ai.skills.length || ai.tools.length || ai.tech_stack.length || ai.learning.length ? (
          <div className="space-y-3">
            {ai.skills.length > 0 && <Chips label="Developing" values={ai.skills} />}
            {ai.tools.length > 0 && <Chips label="Tools to learn" values={ai.tools} />}
            {ai.tech_stack.length > 0 && <Chips label="Uses" values={ai.tech_stack} />}
            {ai.learning.length > 0 && <Chips label="Wants to take" values={ai.learning} />}
          </div>
        ) : (
          <Empty text="Skills, AI tools and courses you want to learn." />
        )}
      </Section>

      <Section
        title="Goals"
        emoji="🎯"
        action={<AddButton label="Add goal" onClick={() => setEditing({ kind: "goal", goal: null })} />}
      >
        {goals.length ? (
          <ItemList
            items={goals.map((g) => ({
              key: g.id,
              title: g.name,
              meta: [
                g.target_date && `By ${formatDate(g.target_date)}`,
                g.priority && `${IMPORTANCE_LABELS[g.priority]} priority`,
                g.weekly_hours && `${g.weekly_hours}h/week`,
                g.why && `Why: ${g.why}`,
              ],
              progress: g.progress ?? 0,
              onEdit: () => setEditing({ kind: "goal", goal: g }),
            }))}
          />
        ) : (
          <Empty text="No goals yet." />
        )}
      </Section>

      <Section title="Interests" emoji="💡" onEdit={() => setEditing({ kind: "interests" })}>
        {ai.interests.length ? <Chips label="Interested in" values={ai.interests} /> : <Empty text="Add what interests you." />}
      </Section>

      <Section title="Schedule" emoji="🕒" onEdit={() => setEditing({ kind: "schedule" })}>
        <Facts
          items={[
            ["Wake up", ai.schedule.wake],
            ["Sleep", ai.schedule.sleep],
            ["Busy", ai.schedule.busy],
            ["Usually free", ai.schedule.free],
            ["Study", ai.schedule.study_time],
            ["Projects", ai.schedule.project_time],
            ["Hours a day for goals", ai.schedule.daily_hours !== undefined ? `${ai.schedule.daily_hours}h` : undefined],
            ["Best energy", ai.preferences.energy],
            ["Sessions", ai.preferences.session],
            ["Tasks per day", ai.preferences.tasks_per_day?.toString()],
            ["Schedule style", ai.preferences.intensity],
            ["Free time to keep", ai.preferences.free_time],
          ]}
        />
      </Section>

      <Section
        title="Busy hours"
        emoji="⛔"
        action={<AddButton label="Add" onClick={() => setEditing({ kind: "block", block: null })} />}
      >
        {ai.blocks.length ? (
          <ul className="divide-y divide-line">
            {ai.blocks.map((b) => (
              <li key={b.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">{b.label}</p>
                  <p className="text-sm text-muted">
                    {describeDays(b.days)} · {b.start}–{b.end}
                  </p>
                </div>
                <IconButton label={`Edit ${b.label}`} onClick={() => setEditing({ kind: "block", block: b })}>
                  <PencilIcon className="h-4 w-4" />
                </IconButton>
                <IconButton
                  label={`Delete ${b.label}`}
                  danger
                  onClick={() => updateAI({ blocks: ai.blocks.filter((x) => x.id !== b.id) }, "Busy hours removed")}
                >
                  <TrashIcon className="h-4 w-4" />
                </IconButton>
              </li>
            ))}
          </ul>
        ) : (
          <Empty text="University classes, work shifts… your AI never plans anything during these." />
        )}
      </Section>

      <Section
        title="Routines"
        emoji="🔁"
        action={<AddButton label="Add routine" onClick={() => setEditing({ kind: "habit", habit: null })} />}
      >
        {ai.habits.length ? (
          <ul className="divide-y divide-line">
            {ai.habits.map((h) => (
              <li key={h.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">{h.name}</p>
                  <p className="text-sm text-muted">
                    {describePattern(h.pattern)}
                    {h.time && ` · ${h.time}`}
                    {h.duration && ` · ${h.duration} min`}
                  </p>
                </div>
                <button
                  onClick={() => addHabitToCalendar(h)}
                  className="rounded-lg px-2 py-1 text-xs font-semibold text-accent hover:bg-accent-soft"
                >
                  Add to calendar
                </button>
                <IconButton label={`Edit ${h.name}`} onClick={() => setEditing({ kind: "habit", habit: h })}>
                  <PencilIcon className="h-4 w-4" />
                </IconButton>
                <IconButton
                  label={`Delete ${h.name}`}
                  danger
                  onClick={() => updateAI({ habits: ai.habits.filter((x) => x.id !== h.id) }, "Routine removed")}
                >
                  <TrashIcon className="h-4 w-4" />
                </IconButton>
              </li>
            ))}
          </ul>
        ) : (
          <Empty text="Gym, prayer, reading, work shifts… your AI plans around them." />
        )}
      </Section>

      <Section title="AI preferences" emoji="✨">
        <p className="mb-2 text-sm text-muted">How should your AI talk to you?</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {AI_STYLES.map((s) => (
            <button
              key={s.value}
              onClick={() =>
                s.value !== profile.ai_personality &&
                save(
                  {
                    ai_personality: s.value,
                    ai_profile: { ...ai, covered: [...new Set([...ai.covered, "style" as const])] },
                  },
                  `Your AI is now ${s.label.toLowerCase()}`
                )
              }
              aria-pressed={style.value === s.value}
              className={`rounded-xl border p-3 text-left transition ${
                style.value === s.value
                  ? "border-accent bg-accent-soft ring-2 ring-accent/30"
                  : "border-line hover:border-accent/40"
              }`}
            >
              <span className="text-lg">{s.emoji}</span>
              <span className="block font-semibold text-ink">{s.label}</span>
              <span className="block text-xs leading-snug text-muted">{s.text}</span>
            </button>
          ))}
        </div>
        <div className="mt-4 flex items-start justify-between gap-3 rounded-xl bg-surface-2 p-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">Custom instructions</p>
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted">
              {ai.instructions || "Nothing yet."}
            </p>
          </div>
          <IconButton label="Edit custom instructions" onClick={() => setEditing({ kind: "instructions" })}>
            <PencilIcon className="h-4 w-4" />
          </IconButton>
        </div>
      </Section>

      <Section title="AI memory" emoji="💾">
        <p className="mb-3 text-sm text-muted">
          Facts your AI uses when planning. The Persona chat adds new ones when you tell it something lasting.
        </p>
        {ai.memory.length > 0 && (
          <ul className="mb-3 space-y-1.5">
            {ai.memory.map((m) => (
              <li key={m.id} className="flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm text-ink">
                <span className="min-w-0 flex-1">{m.text}</span>
                <button
                  onClick={() => updateAI({ memory: ai.memory.filter((x) => x.id !== m.id) }, "Forgotten")}
                  className="shrink-0 text-muted hover:text-danger"
                  aria-label={`Forget: ${m.text}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const text = memoryText.trim();
            if (!text) return;
            updateAI(
              {
                memory: [
                  ...ai.memory,
                  { id: newId(), text, source: "user", created_at: new Date().toISOString() },
                ],
              },
              "Your AI will remember that"
            )?.then((ok) => ok && setMemoryText(""));
          }}
          className="flex gap-2"
        >
          <input
            value={memoryText}
            onChange={(e) => setMemoryText(e.target.value)}
            maxLength={200}
            placeholder="e.g. I work night shifts on weekends"
            aria-label="Something your AI should remember"
            className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none"
          />
          <Button type="submit" size="sm" className="h-auto" disabled={!memoryText.trim() || saving}>
            Remember
          </Button>
        </form>

        <div className="mt-5">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink">
            <BrainIcon className="h-4 w-4 text-accent" />
            Learned from your activity
          </p>
          {insights.length ? (
            <ul className="space-y-1.5">
              {insights.map((i) => (
                <li key={i.key} className="rounded-xl bg-accent-soft/60 px-3 py-2 text-sm text-ink">
                  {i.text}
                </li>
              ))}
            </ul>
          ) : (
            <Empty text="Complete (or skip) a few more tasks and your AI will spot your patterns: best time of day, session length, and more." />
          )}
          {ignoredAreas.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted">
              Suggesting less: {ignoredAreas.map(([area]) => area).join(", ")}
              <button
                onClick={() => updateAI({ ignored: {} }, "Suggestions reset")}
                className="font-medium text-accent hover:underline"
              >
                Reset
              </button>
            </div>
          )}
        </div>
      </Section>

      <Modal
        open={editing !== null}
        title={editing ? EDIT_TITLES[editing.kind] : ""}
        onClose={() => setEditing(null)}
      >
        {editing?.kind === "about" && (
          <AboutForm
            initial={{
              name: profile.display_name ?? "",
              roles: ai.about.roles,
              headline: ai.about.headline ?? "",
              age_range: ai.about.age_range ?? "",
            }}
            saving={saving}
            onCancel={() => setEditing(null)}
            onSave={({ name, roles, headline, age_range }: AboutValues) =>
              save({
                display_name: name.trim() || null,
                ai_profile: {
                  ...ai,
                  about: {
                    roles,
                    headline: headline.trim() || undefined,
                    age_range: age_range || undefined,
                  },
                },
              })
            }
          />
        )}
        {editing?.kind === "education" && (
          <FieldsForm
            fields={[...EDUCATION_FIELDS]}
            initial={ai.education}
            saving={saving}
            onCancel={() => setEditing(null)}
            onSave={(education) => updateAI({ education })}
          />
        )}
        {editing?.kind === "work" && (
          <FieldsForm
            fields={[...WORK_FIELDS]}
            initial={ai.work}
            saving={saving}
            onCancel={() => setEditing(null)}
            onSave={(values) => updateAI({ work: values })}
          />
        )}
        {editing?.kind === "business" && (
          <ListsForm
            lists={[...BUSINESS_LISTS]}
            initial={ai.business}
            saving={saving}
            onCancel={() => setEditing(null)}
            onSave={(business) => updateAI({ business })}
          />
        )}
        {editing?.kind === "skills" && (
          <ListsForm
            lists={[...SKILL_LISTS]}
            initial={{ skills: ai.skills, tools: ai.tools, tech_stack: ai.tech_stack, learning: ai.learning }}
            saving={saving}
            onCancel={() => setEditing(null)}
            onSave={(values) => updateAI(values)}
          />
        )}
        {editing?.kind === "interests" && (
          <InterestsForm
            initial={ai.interests}
            saving={saving}
            onCancel={() => setEditing(null)}
            onSave={(interests) => updateAI({ interests })}
          />
        )}
        {editing?.kind === "schedule" && (
          <ScheduleForm
            initial={{ schedule: ai.schedule, preferences: ai.preferences }}
            saving={saving}
            onCancel={() => setEditing(null)}
            onSave={(values: ScheduleValues) => updateAI(values)}
          />
        )}
        {editing?.kind === "instructions" && (
          <InstructionsForm
            initial={ai.instructions}
            saving={saving}
            onCancel={() => setEditing(null)}
            onSave={(instructions) => updateAI({ instructions })}
          />
        )}
        {editing?.kind === "habit" && (
          <HabitForm
            initial={editing.habit}
            saving={saving}
            onCancel={() => setEditing(null)}
            onSave={(habit) =>
              updateAI({
                habits: editing.habit
                  ? ai.habits.map((h) => (h.id === habit.id ? habit : h))
                  : [...ai.habits, habit],
              })
            }
          />
        )}
        {editing?.kind === "block" && (
          <BlockForm
            initial={editing.block}
            saving={saving}
            onCancel={() => setEditing(null)}
            onSave={(block) =>
              updateAI({
                blocks: editing.block
                  ? ai.blocks.map((b) => (b.id === block.id ? block : b))
                  : [...ai.blocks, block],
              })
            }
          />
        )}
        {editing?.kind === "project" && (
          <>
            <ProjectForm
              key={editing.project?.id ?? `new-${editing.defaultKind}`}
              editingProject={editing.project}
              defaultKind={editing.defaultKind}
              onCancel={() => setEditing(null)}
              onProjectSaved={() => {
                setEditing(null);
                refresh();
                toast("Saved");
              }}
            />
            {editing.project && (
              <DeleteRow
                label={`Delete "${editing.project.name}"`}
                onDelete={async () => {
                  const { error } = await supabase.from("projects").delete().eq("id", editing.project!.id);
                  if (error) return toast("Couldn't delete. Try again.", { tone: "error" });
                  setEditing(null);
                  refresh();
                }}
              />
            )}
          </>
        )}
        {editing?.kind === "goal" && (
          <>
            <GoalForm
              key={editing.goal?.id ?? "new"}
              editingGoal={editing.goal}
              onCancel={() => setEditing(null)}
              onGoalSaved={() => {
                setEditing(null);
                refresh();
                toast("Saved");
              }}
            />
            {editing.goal && (
              <DeleteRow
                label={`Delete "${editing.goal.name}"`}
                onDelete={async () => {
                  const { error } = await supabase.from("goals").delete().eq("id", editing.goal!.id);
                  if (error) return toast("Couldn't delete. Try again.", { tone: "error" });
                  setEditing(null);
                  refresh();
                }}
              />
            )}
          </>
        )}
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------- pieces

function Section({
  title,
  emoji,
  onEdit,
  action,
  children,
}: {
  title: string;
  emoji: string;
  onEdit?: () => void;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-surface p-4 shadow-card sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold text-ink">
          <span aria-hidden="true">{emoji}</span>
          {title}
        </h2>
        {action}
        {onEdit && (
          <button
            onClick={onEdit}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-accent hover:bg-accent-soft"
          >
            <PencilIcon className="h-3.5 w-3.5" />
            Edit
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-accent hover:bg-accent-soft"
    >
      <PlusIcon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function IconButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`rounded-lg p-1.5 text-muted ${danger ? "hover:bg-danger-soft hover:text-danger" : "hover:bg-surface-2 hover:text-ink"}`}
    >
      {children}
    </button>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-muted">{text}</p>;
}

function Facts({ items }: { items: [string, string | null | undefined][] }) {
  const known = items.filter(([, v]) => v);
  if (!known.length) return <Empty text="Nothing yet. Tap Edit to add." />;
  return (
    <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
      {known.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs text-muted">{label}</dt>
          <dd className="truncate text-ink first-letter:uppercase">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Chips({ label, values }: { label: string; values: string[] }) {
  return (
    <div>
      <p className="mb-1.5 text-xs text-muted">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {values.map((v) => (
          <span key={v} className="rounded-full bg-accent-soft px-3 py-1 text-sm text-accent">
            {v}
          </span>
        ))}
      </div>
    </div>
  );
}

function ItemList({
  items,
}: {
  items: {
    key: string;
    title: string;
    meta: (string | null | false | 0 | undefined)[];
    progress: number;
    onEdit: () => void;
  }[];
}) {
  return (
    <ul className="divide-y divide-line">
      {items.map((item) => (
        <li key={item.key}>
          <button onClick={item.onEdit} className="flex w-full items-center gap-3 py-2.5 text-left">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-ink">{item.title}</p>
              <p className="truncate text-sm text-muted">{item.meta.filter(Boolean).join(" · ") || "Tap to add details"}</p>
              <div className="mt-1.5 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-grad-from to-grad-to"
                    style={{ width: `${item.progress}%` }}
                  />
                </div>
                <span className="w-9 text-right text-xs tabular-nums text-muted">{item.progress}%</span>
              </div>
            </div>
            <PencilIcon className="h-4 w-4 shrink-0 text-muted" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function DeleteRow({ label, onDelete }: { label: string; onDelete: () => void }) {
  return (
    <button
      onClick={() => confirm(`${label}? Its tasks are kept.`) && onDelete()}
      className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-medium text-danger hover:bg-danger-soft"
    >
      <TrashIcon className="h-4 w-4" />
      {label}
    </button>
  );
}
