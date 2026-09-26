"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { getProfile, saveProfile } from "@/lib/queries/persona";
import { getProjects } from "@/lib/queries/projects";
import { getGoals } from "@/lib/queries/goals";
import { getTaskEvents, getTasks, updateTasks } from "@/lib/queries/tasks";
import { getAssessments } from "@/lib/queries/assessments";
import { computeInsights } from "@/lib/persona/insights";
import { sectionStatus } from "@/lib/persona/sections";
import { busyConflictsAfterEdit, fixesFor } from "@/lib/persona/busy-check";
import { describePattern } from "@/lib/assistant/patterns";
import {
  createSeries,
  deleteSeries,
  getSeries,
  isActive,
  resumeSeries,
  stopSeries,
  streakOf,
  updateSeries,
} from "@/lib/series";
import { parseIcs, type IcsImport } from "@/lib/ics";
import { notifyTasksChanged } from "@/lib/QuickAdd";
import { useToast } from "@/components/Toast";
import ProjectForm from "@/components/ProjectForm";
import GoalForm from "@/components/GoalForm";
import {
  AboutForm,
  BlockForm,
  BusinessForm,
  FieldsForm,
  InstructionsForm,
  InterestsForm,
  RoutineForm,
  ScheduleForm,
  SkillsForm,
  WorkForm,
  type AboutValues,
  type RoutineValues,
  type ScheduleValues,
} from "@/components/ProfileForms";
import { Button, ErrorState, Modal, Select, Skeleton } from "@/components/ui";
import { BrainIcon, PencilIcon, PlusIcon, SparklesIcon, TrashIcon } from "@/components/icons";
import { formatDate, toLocalDateString } from "@/utils/date";
import {
  AI_STYLES,
  BUSINESS_STAGE_LABELS,
  describeBlock,
  describeDays,
  EMPLOYMENT_LABELS,
  hasPersona,
  IMPORTANCE_LABELS,
  MEMORY_CATEGORIES,
  newId,
  roleOf,
  SECTIONS,
  SKILL_STATUSES,
  styleOf,
  type AIProfile,
  type AIStyle,
  type BusyBlock,
  type MemoryCategory,
  type Profile,
} from "@/types/persona";
import { kindOf, type Assessment, type Project, type ProjectKind } from "@/types/project";
import type { Goal } from "@/types/goal";
import type { Series, Task, TaskEvent } from "@/types/task";

type Editing =
  | { kind: "about" }
  | { kind: "education" }
  | { kind: "work" }
  | { kind: "business" }
  | { kind: "skills" }
  | { kind: "interests" }
  | { kind: "schedule" }
  | { kind: "instructions" }
  | { kind: "routine"; series: Series | null }
  | { kind: "block"; block: BusyBlock | null }
  | { kind: "import"; data: IcsImport }
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
  routine: "Routine",
  block: "Busy hours",
  import: "Import from your calendar",
  project: "Course or project",
  goal: "Goal",
};

const EDUCATION_FIELDS = [
  { key: "university", label: "University", placeholder: "e.g. Cairo University" },
  { key: "faculty", label: "Faculty", placeholder: "e.g. Faculty of Engineering" },
  { key: "major", label: "Major", placeholder: "e.g. Computer Engineering" },
  { key: "term", label: "Current year / term", placeholder: "e.g. Last term" },
  { key: "graduation", label: "Graduation", placeholder: "e.g. June 2027" },
  { key: "semester_start", label: "Semester starts", type: "date" },
  { key: "semester_end", label: "Semester ends", type: "date" },
  { key: "exam_period_start", label: "Exam period starts", type: "date" },
  { key: "exam_period_end", label: "Exam period ends", type: "date" },
] as const;

export default function PersonaPage() {
  const { user } = useAuth();
  const toast = useToast();
  const today = toLocalDateString();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [series, setSeries] = useState<Series[]>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [saving, setSaving] = useState(false);
  const [memoryText, setMemoryText] = useState("");
  const [memoryCategory, setMemoryCategory] = useState<MemoryCategory>("fact");
  const [memoryExpires, setMemoryExpires] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    if (!user) return;
    Promise.all([
      getProfile(user.id),
      getProjects(),
      getGoals(),
      getTasks({ pastDays: 60, futureDays: 30 }).catch(() => [] as Task[]),
      getSeries(supabase).catch(() => [] as Series[]),
      getAssessments().catch(() => [] as Assessment[]),
      getTaskEvents(35),
    ])
      .then(([p, pr, g, t, s, a, e]) => {
        setProfile(p);
        setProjects(pr);
        setGoals(g);
        setTasks(t);
        setSeries(s);
        setAssessments(a);
        setEvents(e);
        setLoadError("");
      })
      .catch((e: Error) => setLoadError(e.message));
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const insights = useMemo(
    () => computeInsights(tasks, today, events, profile?.timezone ?? "UTC"),
    [tasks, today, events, profile?.timezone]
  );

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
    profile ? save({ ai_profile: { ...profile.ai_profile, ...patch } }, message) : Promise.resolve(false);

  // Busy hours changed: tell the user which upcoming tasks now overlap
  const saveBlocks = async (blocks: BusyBlock[], message: string) => {
    if (!profile) return;
    if (!(await updateAI({ blocks }, message))) return;
    const next = { ...profile.ai_profile, blocks };
    const clashes = busyConflictsAfterEdit(next, tasks, today);
    if (clashes.length) {
      toast(
        `${clashes.length} upcoming task${clashes.length > 1 ? "s" : ""} now overlap${clashes.length > 1 ? "" : "s"} your busy hours: ${clashes
          .slice(0, 2)
          .map((t) => t.title)
          .join(", ")}${clashes.length > 2 ? "…" : ""}.`,
        {
          tone: "error",
          action: {
            label: "Move them",
            onClick: async () => {
              const changes = fixesFor(next, tasks, clashes);
              if (!changes.length || !(await updateTasks(changes))) {
                toast("Couldn't find free time for them. Move them in the Calendar.", { tone: "error" });
                return;
              }
              notifyTasksChanged();
              refresh();
              toast(`Moved ${changes.length} task${changes.length > 1 ? "s" : ""} to free time.`);
            },
          },
        }
      );
    }
  };

  const saveRoutine = async (values: RoutineValues, existing: Series | null) => {
    if (!user) return;
    setSaving(true);
    const ok = existing
      ? await updateSeries(supabase, existing, values, "all", today, today)
      : !!(await createSeries(supabase, user.id, { ...values, start_date: today, is_routine: true, priority: "medium" }, today));
    setSaving(false);
    if (!ok) return toast("Couldn't save the routine. Try again.", { tone: "error" });
    setEditing(null);
    notifyTasksChanged();
    refresh();
    toast(existing ? "Routine updated" : `“${values.title}” is on your calendar`);
  };

  const importCalendar = async (file: File) => {
    const text = await file.text().catch(() => "");
    const data = parseIcs(text, today);
    if (!data.blocks.length && !data.events.length) {
      toast("Nothing to import: no weekly events or upcoming events found in that file.", { tone: "error" });
      return;
    }
    setEditing({ kind: "import", data });
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
  const known = hasPersona(profile);
  const courses = projects.filter((p) => p.kind === "course");
  const work = projects.filter((p) => p.kind !== "course" && p.kind !== "milestone");
  const status = sectionStatus(ai, projects, goals, series);
  const done = Object.values(status).filter(Boolean).length;
  const style = styleOf(profile.ai_personality);
  const name = profile.display_name ?? user?.email?.split("@")[0] ?? "You";
  const areaName = (id: string) => projects.find((p) => p.id === id)?.name ?? goals.find((g) => g.id === id)?.name ?? id;
  const ignoredAreas = Object.entries(ai.ignored).filter(([, v]) => v.count > 0);
  const routines = series.filter((s) => s.is_routine || isActive(s, today));
  const openProject = (project: Project | null, defaultKind: ProjectKind) =>
    setEditing({ kind: "project", project, defaultKind });
  const nextExam = (courseId: string) =>
    assessments
      .filter((a) => a.project_id === courseId && !a.done && a.due_date >= today)
      .sort((a, b) => a.due_date.localeCompare(b.due_date))[0];

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

        <div className="mt-4 flex items-center gap-2 text-sm">
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
        <p className="mt-2 text-xs opacity-60">
          Everything here is used by your AI every time it plans. It&apos;s yours: edit or delete anything.
        </p>

        <Link
          href={known ? "/onboarding?mode=update" : "/onboarding"}
          className="mt-4 flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-grad-from to-grad-to font-semibold text-white shadow-lg shadow-black/20 transition hover:brightness-110"
        >
          <SparklesIcon className="h-4 w-4" />
          {known ? "Tell my AI what changed" : "Tell my AI about me · 1 min"}
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
          <Empty text="Your AI writes a short summary of you after the quick start." />
        )}
        <p className="mt-3 text-xs text-muted">
          Edit anything below, or just tell the assistant what changed (“I started working”, “my exam moved to Dec 20”).
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
            [
              "Semester",
              ai.education.semester_start || ai.education.semester_end
                ? `${ai.education.semester_start ? formatDate(ai.education.semester_start) : "?"} – ${ai.education.semester_end ? formatDate(ai.education.semester_end) : "?"}`
                : null,
            ],
            [
              "Exam period",
              ai.education.exam_period_start
                ? `${formatDate(ai.education.exam_period_start)} – ${ai.education.exam_period_end ? formatDate(ai.education.exam_period_end) : "?"}`
                : null,
            ],
          ]}
        />
      </Section>

      <Section
        title="Courses & exams"
        emoji="📚"
        action={<AddButton label="Add course" onClick={() => openProject(null, "course")} />}
      >
        {courses.length ? (
          <ul className="divide-y divide-line">
            {courses.map((c) => {
              const exam = nextExam(c.id);
              return (
                <li key={c.id}>
                  <Link href={`/projects/${c.id}`} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-ink">{c.name}</p>
                      <p className="truncate text-sm text-muted">
                        {[
                          exam ? `${exam.title} ${formatDate(exam.due_date)}` : "No upcoming exam",
                          c.importance && `${IMPORTANCE_LABELS[c.importance]} importance`,
                          c.weekly_hours && `${c.weekly_hours}h/week`,
                          !c.ai_help && "No AI suggestions",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <span className="text-muted">›</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty text="No courses yet." />
        )}
      </Section>

      <Section title="Work" emoji="💼" onEdit={() => setEditing({ kind: "work" })}>
        <Facts
          items={[
            ["Job", ai.work.job],
            ["Company", ai.work.company],
            ["Type", ai.work.employment && EMPLOYMENT_LABELS[ai.work.employment]],
            ["Days off", ai.work.days_off?.length ? describeDays(ai.work.days_off) : null],
            ["Commute", ai.work.commute_minutes ? `${ai.work.commute_minutes} min each way` : null],
            ["Responsibilities", ai.work.responsibilities],
          ]}
        />
      </Section>

      <Section title="Projects" emoji="🛠️" action={<AddButton label="Add" onClick={() => openProject(null, "project")} />}>
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
              onEdit: () => openProject(p, p.kind),
            }))}
          />
        ) : (
          <Empty text="Graduation project, work projects, freelance clients, your business…" />
        )}
      </Section>

      <Section title="Business" emoji="🚀" onEdit={() => setEditing({ kind: "business" })}>
        {ai.business.ideas.length || ai.business.interests.length || ai.business.stage ? (
          <div className="space-y-3">
            {ai.business.stage && <Facts items={[["Stage", BUSINESS_STAGE_LABELS[ai.business.stage]]]} />}
            {ai.business.ideas.length > 0 && <Chips label="Ideas" values={ai.business.ideas} />}
            {ai.business.interests.length > 0 && <Chips label="Interested in" values={ai.business.interests} />}
          </div>
        ) : (
          <Empty text="Business ideas, what kind of business interests you, and how far along you are." />
        )}
      </Section>

      <Section title="Skills & learning" emoji="🧩" onEdit={() => setEditing({ kind: "skills" })}>
        {ai.skills.length ? (
          <div className="space-y-3">
            {SKILL_STATUSES.map((st) => {
              const names = ai.skills.filter((s) => s.status === st.value).map((s) => s.name);
              return names.length ? <Chips key={st.value} label={st.label} values={names} /> : null;
            })}
          </div>
        ) : (
          <Empty text="What you know, are learning, or want to learn: skills, tools, technologies, topics." />
        )}
      </Section>

      <Section title="Goals" emoji="🎯" action={<AddButton label="Add goal" onClick={() => setEditing({ kind: "goal", goal: null })} />}>
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
            ["Rest days", ai.schedule.rest_days?.length ? describeDays(ai.schedule.rest_days) : null],
            ["Study", ai.schedule.study_time],
            ["Projects", ai.schedule.project_time],
            ["Focused hours a day", ai.schedule.daily_hours !== undefined ? `${ai.schedule.daily_hours}h` : undefined],
            ["Best energy", ai.preferences.energy],
            ["Sessions", ai.preferences.session],
            ["Tasks per day", ai.preferences.tasks_per_day?.toString()],
            ["Schedule style", ai.preferences.intensity],
            ["Free time to keep", ai.preferences.free_time],
            [
              "Session lengths",
              ai.preferences.durations
                ? Object.entries(ai.preferences.durations)
                    .map(([k, v]) => `${k} ${v}m`)
                    .join(", ")
                : null,
            ],
            [
              "Time split",
              ai.preferences.balance
                ? Object.entries(ai.preferences.balance)
                    .map(([r, v]) => `${roleOf(r as never).label} ${v}%`)
                    .join(", ")
                : null,
            ],
            ["AI language", ai.preferences.language],
          ]}
        />
      </Section>

      <Section
        title="Busy hours"
        emoji="⛔"
        action={
          <div className="flex gap-1">
            <button
              onClick={() => fileInput.current?.click()}
              className="rounded-lg px-2 py-1 text-sm font-medium text-accent hover:bg-accent-soft"
            >
              Import .ics
            </button>
            <AddButton label="Add" onClick={() => setEditing({ kind: "block", block: null })} />
          </div>
        }
      >
        <input
          ref={fileInput}
          type="file"
          accept=".ics,text/calendar"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) importCalendar(file);
          }}
        />
        {ai.blocks.length ? (
          <ul className="divide-y divide-line">
            {ai.blocks.map((b) => (
              <li key={b.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">
                    {b.label}
                    {b.course_id && <span className="font-normal text-muted"> · {areaName(b.course_id)}</span>}
                  </p>
                  <p className="text-sm text-muted">{describeBlock(b)}</p>
                </div>
                <IconButton label={`Edit ${b.label}`} onClick={() => setEditing({ kind: "block", block: b })}>
                  <PencilIcon className="h-4 w-4" />
                </IconButton>
                <IconButton
                  label={`Delete ${b.label}`}
                  danger
                  onClick={() => saveBlocks(ai.blocks.filter((x) => x.id !== b.id), "Busy hours removed")}
                >
                  <TrashIcon className="h-4 w-4" />
                </IconButton>
              </li>
            ))}
          </ul>
        ) : (
          <Empty text="University classes, work shifts (overnight too)… your AI never plans anything during these. Import them from Google Calendar or your timetable (.ics)." />
        )}
      </Section>

      <Section title="Routines" emoji="🔁" action={<AddButton label="Add routine" onClick={() => setEditing({ kind: "routine", series: null })} />}>
        {routines.length ? (
          <ul className="divide-y divide-line">
            {routines.map((s) => {
              const active = isActive(s, today);
              const streak = streakOf(s.id, tasks, today);
              return (
                <li key={s.id} className={`flex items-center gap-3 py-2.5 ${active ? "" : "opacity-60"}`}>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">
                      {s.title}
                      {streak >= 2 && <span className="ml-2 text-sm font-semibold text-warn">🔥 {streak}</span>}
                    </p>
                    <p className="text-sm text-muted">
                      {describePattern(s.pattern)}
                      {s.due_time && ` · ${s.due_time.slice(0, 5)}`}
                      {s.estimated_duration && ` · ${s.estimated_duration} min`}
                      {!active && " · stopped"}
                    </p>
                  </div>
                  <button
                    onClick={async () => {
                      const ok = active ? await stopSeries(supabase, s, today) : await resumeSeries(supabase, s, today);
                      if (!ok) return toast("Couldn't update the routine.", { tone: "error" });
                      notifyTasksChanged();
                      refresh();
                      toast(active ? `“${s.title}” stopped` : `“${s.title}” resumed`);
                    }}
                    className="rounded-lg px-2 py-1 text-xs font-semibold text-accent hover:bg-accent-soft"
                  >
                    {active ? "Stop" : "Resume"}
                  </button>
                  <IconButton label={`Edit ${s.title}`} onClick={() => setEditing({ kind: "routine", series: s })}>
                    <PencilIcon className="h-4 w-4" />
                  </IconButton>
                  <IconButton
                    label={`Delete ${s.title}`}
                    danger
                    onClick={async () => {
                      if (!confirm(`Delete “${s.title}”? Upcoming sessions are removed; completed ones stay in your history.`)) return;
                      if (!(await deleteSeries(supabase, s))) return toast("Couldn't delete.", { tone: "error" });
                      notifyTasksChanged();
                      refresh();
                    }}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </IconButton>
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty text="Gym, prayer, reading… they go on your calendar and your AI plans around them." />
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
                style.value === s.value ? "border-accent bg-accent-soft ring-2 ring-accent/30" : "border-line hover:border-accent/40"
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
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted">{ai.instructions || "Nothing yet."}</p>
          </div>
          <IconButton label="Edit custom instructions" onClick={() => setEditing({ kind: "instructions" })}>
            <PencilIcon className="h-4 w-4" />
          </IconButton>
        </div>
      </Section>

      <Section title="AI memory" emoji="💾">
        <p className="mb-3 text-sm text-muted">
          Notes your AI uses when planning. The assistant adds new ones when you tell it something lasting (you can undo
          them in the chat). Pinned notes are never merged away; notes with an end date stop applying after it.
        </p>
        {ai.memory.length > 0 && (
          <ul className="mb-3 space-y-1.5">
            {ai.memory.map((m) => {
              const expired = !!m.expires_at && m.expires_at < today;
              return (
                <li
                  key={m.id}
                  className={`flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm text-ink ${expired ? "opacity-50" : ""}`}
                >
                  <span className="min-w-0 flex-1">
                    {m.text}
                    <span className="block text-xs text-muted">
                      {MEMORY_CATEGORIES.find((c) => c.value === m.category)?.label}
                      {m.source === "ai" ? " · learned by AI" : ""}
                      {m.expires_at ? ` · ${expired ? "ended" : "until"} ${formatDate(m.expires_at)}` : ""}
                    </span>
                  </span>
                  <button
                    onClick={() =>
                      updateAI(
                        { memory: ai.memory.map((x) => (x.id === m.id ? { ...x, pinned: !x.pinned } : x)) },
                        m.pinned ? "Unpinned" : "Pinned"
                      )
                    }
                    className={`shrink-0 ${m.pinned ? "text-accent" : "text-muted hover:text-ink"}`}
                    aria-label={m.pinned ? `Unpin: ${m.text}` : `Pin: ${m.text}`}
                    aria-pressed={m.pinned}
                  >
                    📌
                  </button>
                  <button
                    onClick={() => updateAI({ memory: ai.memory.filter((x) => x.id !== m.id) }, "Forgotten")}
                    className="shrink-0 text-muted hover:text-danger"
                    aria-label={`Forget: ${m.text}`}
                  >
                    ×
                  </button>
                </li>
              );
            })}
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
                  {
                    id: newId(),
                    text,
                    source: "user",
                    category: memoryCategory,
                    pinned: true,
                    expires_at: memoryExpires || null,
                    created_at: new Date().toISOString(),
                  },
                ],
              },
              "Your AI will remember that"
            ).then((ok) => {
              if (ok) {
                setMemoryText("");
                setMemoryExpires("");
              }
            });
          }}
          className="space-y-2"
        >
          <input
            value={memoryText}
            onChange={(e) => setMemoryText(e.target.value)}
            maxLength={200}
            placeholder="e.g. I work night shifts on weekends"
            aria-label="Something your AI should remember"
            className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none"
          />
          <div className="flex gap-2">
            <Select
              value={memoryCategory}
              onChange={(e) => setMemoryCategory(e.target.value as MemoryCategory)}
              className="py-2! text-sm"
              aria-label="Kind of note"
            >
              {MEMORY_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
            <input
              type="date"
              value={memoryExpires}
              onChange={(e) => setMemoryExpires(e.target.value)}
              aria-label="True until (optional)"
              title="True until (optional)"
              className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
            />
            <Button type="submit" size="sm" className="h-auto" disabled={!memoryText.trim() || saving}>
              Remember
            </Button>
          </div>
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
            <Empty text="Complete (or skip) a few more tasks and your AI will spot your patterns: best time of day, how long things really take, and more." />
          )}
          {ignoredAreas.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted">
              Suggesting less: {ignoredAreas.map(([id]) => areaName(id)).join(", ")}
              <button onClick={() => updateAI({ ignored: {} }, "Suggestions reset")} className="font-medium text-accent hover:underline">
                Reset
              </button>
            </div>
          )}
        </div>
      </Section>

      <Modal open={editing !== null} title={editing ? EDIT_TITLES[editing.kind] : ""} onClose={() => setEditing(null)}>
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
                  about: { roles, headline: headline.trim() || undefined, age_range: age_range || undefined },
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
          <WorkForm initial={ai.work} saving={saving} onCancel={() => setEditing(null)} onSave={(w) => updateAI({ work: w })} />
        )}
        {editing?.kind === "business" && (
          <BusinessForm initial={ai.business} saving={saving} onCancel={() => setEditing(null)} onSave={(business) => updateAI({ business })} />
        )}
        {editing?.kind === "skills" && (
          <SkillsForm initial={ai.skills} saving={saving} onCancel={() => setEditing(null)} onSave={(skills) => updateAI({ skills })} />
        )}
        {editing?.kind === "interests" && (
          <InterestsForm initial={ai.interests} saving={saving} onCancel={() => setEditing(null)} onSave={(interests) => updateAI({ interests })} />
        )}
        {editing?.kind === "schedule" && (
          <ScheduleForm
            initial={{ schedule: ai.schedule, preferences: ai.preferences }}
            roles={ai.about.roles}
            saving={saving}
            onCancel={() => setEditing(null)}
            onSave={(values: ScheduleValues) => updateAI(values)}
          />
        )}
        {editing?.kind === "instructions" && (
          <InstructionsForm initial={ai.instructions} saving={saving} onCancel={() => setEditing(null)} onSave={(instructions) => updateAI({ instructions })} />
        )}
        {editing?.kind === "routine" && (
          <RoutineForm
            initial={editing.series}
            saving={saving}
            onCancel={() => setEditing(null)}
            onSave={(values) => saveRoutine(values, editing.series)}
          />
        )}
        {editing?.kind === "block" && (
          <BlockForm
            initial={editing.block}
            courses={courses}
            saving={saving}
            onCancel={() => setEditing(null)}
            onSave={(block) =>
              saveBlocks(
                editing.block ? ai.blocks.map((b) => (b.id === block.id ? block : b)) : [...ai.blocks, block],
                "Busy hours saved"
              )
            }
          />
        )}
        {editing?.kind === "import" && (
          <ImportPreview
            data={editing.data}
            onCancel={() => setEditing(null)}
            onImport={async (blocks, events) => {
              if (!user) return;
              if (blocks.length) {
                const merged = [...ai.blocks];
                for (const b of blocks) {
                  if (!merged.some((x) => x.label === b.label && x.start === b.start && x.end === b.end)) merged.push(b);
                }
                await saveBlocks(merged.slice(0, 20), `Imported ${blocks.length} busy block${blocks.length > 1 ? "s" : ""}`);
              }
              if (events.length) {
                const { error } = await supabase.from("tasks").insert(
                  events.map((ev) => ({
                    user_id: user.id,
                    title: ev.title,
                    due_date: ev.date,
                    due_time: ev.start,
                    end_time: ev.start ? ev.end : null,
                    is_fixed: true,
                    status: "todo",
                    source: "system",
                  }))
                );
                if (error) toast("Couldn't import the events.", { tone: "error" });
                else toast(`Added ${events.length} event${events.length > 1 ? "s" : ""} as fixed tasks`);
                notifyTasksChanged();
              }
              setEditing(null);
            }}
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

function ImportPreview({
  data,
  onImport,
  onCancel,
}: {
  data: IcsImport;
  onImport: (blocks: BusyBlock[], events: IcsImport["events"]) => void;
  onCancel: () => void;
}) {
  const [blocks, setBlocks] = useState(() => new Set(data.blocks.map((b) => b.id)));
  const [withEvents, setWithEvents] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-4">
      {data.blocks.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium text-ink">Weekly events → busy hours</p>
          <ul className="space-y-1.5">
            {data.blocks.map((b) => (
              <li key={b.id}>
                <label className="flex items-start gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={blocks.has(b.id)}
                    onChange={(e) =>
                      setBlocks((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(b.id);
                        else next.delete(b.id);
                        return next;
                      })
                    }
                    className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                  />
                  <span>
                    <span className="font-medium">{b.label}</span>
                    <span className="block text-muted">{describeBlock(b)}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.events.length > 0 && (
        <label className="flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={withEvents}
            onChange={(e) => setWithEvents(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
          />
          <span>
            Also add {data.events.length} upcoming one-off event{data.events.length > 1 ? "s" : ""} (exams, meetings…) as
            fixed tasks
            <span className="block text-muted">
              {data.events
                .slice(0, 3)
                .map((e) => `${e.title} (${formatDate(e.date)})`)
                .join(", ")}
              {data.events.length > 3 ? "…" : ""}
            </span>
          </span>
        </label>
      )}
      <p className="text-xs text-muted">The file is read on your device; only what you import is saved.</p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          disabled={busy || (!blocks.size && !withEvents)}
          onClick={async () => {
            setBusy(true);
            await onImport(
              data.blocks.filter((b) => blocks.has(b.id)),
              withEvents ? data.events : []
            );
            setBusy(false);
          }}
        >
          {busy ? "Importing..." : "Import"}
        </Button>
      </div>
    </div>
  );
}

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
    <button onClick={onClick} className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-accent hover:bg-accent-soft">
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

function Facts({ items }: { items: [string, string | null | undefined | false][] }) {
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
