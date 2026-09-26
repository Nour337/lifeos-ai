"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabaseClient";
import { deleteAssessment, getAssessments, saveAssessment } from "@/lib/queries/assessments";
import { getProfile } from "@/lib/queries/persona";
import { getTasks } from "@/lib/queries/tasks";
import { scheduleInput } from "@/lib/schedule";
import { planStudySessions, type StudySession } from "@/lib/study-plan";
import { notifyTasksChanged } from "@/lib/QuickAdd";
import { useToast } from "@/components/Toast";
import { Button, Card, Field, Input, Select } from "@/components/ui";
import { PlusIcon, TrashIcon } from "@/components/icons";
import { describeDue, formatDate, formatDuration, minutesToTime, timeToMinutes, toLocalDateString } from "@/utils/date";
import { ASSESSMENT_TYPES, type Assessment, type AssessmentType, type Project } from "@/types/project";

// A course's exams, quizzes and assignments, and exam mode: one tap makes
// spaced study sessions before an exam, in free time (no AI). If a session
// is missed, the Today screen's catch-up moves it to a free slot before
// the exam.
export default function CourseExams({ course }: { course: Project }) {
  const { user } = useAuth();
  const toast = useToast();
  const today = toLocalDateString();
  const [items, setItems] = useState<Assessment[]>([]);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<AssessmentType>("exam");
  const [date, setDate] = useState("");
  const [weight, setWeight] = useState("");
  const [plan, setPlan] = useState<{ exam: Assessment; sessions: StudySession[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getAssessments(course.id)
      .then(setItems)
      .catch(() => setItems([]));
  }, [course.id]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !date) return;
    const saved = await saveAssessment(user.id, {
      project_id: course.id,
      type,
      title: title.trim() || `${course.name} ${ASSESSMENT_TYPES.find((t) => t.value === type)?.label.toLowerCase()}`,
      due_date: date,
      due_time: null,
      weight: weight ? Number(weight) : null,
      done: false,
    });
    if (!saved) return toast("Couldn't save. Try again.", { tone: "error" });
    setAdding(false);
    setTitle("");
    setDate("");
    setWeight("");
    load();
  };

  const preview = async (exam: Assessment) => {
    if (!user) return;
    setBusy(true);
    const [profile, tasks] = await Promise.all([
      getProfile(user.id).catch(() => null),
      getTasks({ pastDays: 1, futureDays: 90 }).catch(() => []),
    ]);
    const now = new Date();
    const sessions = planStudySessions(
      course,
      exam,
      scheduleInput(profile?.ai_profile ?? null, tasks),
      profile?.ai_profile ?? null,
      today,
      now.getHours() * 60 + now.getMinutes() + 30
    );
    setBusy(false);
    if (!sessions.length) return toast("There's no free time before this exam to plan sessions.", { tone: "error" });
    setPlan({ exam, sessions });
  };

  const createPlan = async () => {
    if (!user || !plan) return;
    setBusy(true);
    const { error } = await supabase.from("tasks").insert(
      plan.sessions.map((s) => ({
        user_id: user.id,
        title: s.title,
        due_date: s.date,
        due_time: s.time,
        end_time: minutesToTime(timeToMinutes(s.time) + s.minutes),
        estimated_duration: s.minutes,
        project_id: course.id,
        priority: "high",
        energy: "deep",
        status: "todo",
        source: "system",
        description: `Study plan for ${plan.exam.title} (${formatDate(plan.exam.due_date)})`,
      }))
    );
    setBusy(false);
    if (error) return toast("Couldn't create the plan. Try again.", { tone: "error" });
    setPlan(null);
    notifyTasksChanged();
    toast(`Added ${plan.sessions.length} study sessions before ${plan.exam.title}`);
  };

  const upcoming = items.filter((a) => a.due_date >= today && !a.done);
  const past = items.filter((a) => a.due_date < today || a.done);

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-ink">📝 Exams & assignments</h2>
        <button
          onClick={() => setAdding((v) => !v)}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-accent hover:bg-accent-soft"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          Add
        </button>
      </div>

      {adding && (
        <form onSubmit={add} className="mb-4 grid grid-cols-2 gap-3 rounded-xl bg-surface-2/60 p-3">
          <Field label="Type">
            {(id) => (
              <Select id={id} value={type} onChange={(e) => setType(e.target.value as AssessmentType)}>
                {ASSESSMENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Date">{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />}</Field>
          <Field label="Name (optional)">
            {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} placeholder="e.g. Midterm" />}
          </Field>
          <Field label="% of grade">
            {(id) => <Input id={id} type="number" min={0} max={100} value={weight} onChange={(e) => setWeight(e.target.value)} />}
          </Field>
          <div className="col-span-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!date}>
              Save
            </Button>
          </div>
        </form>
      )}

      {upcoming.length === 0 && past.length === 0 && !adding && (
        <p className="text-sm text-muted">Add the midterm, final, quizzes and assignments; your AI plans around them.</p>
      )}

      <ul className="divide-y divide-line">
        {[...upcoming, ...past].map((a) => {
          const isUpcoming = upcoming.includes(a);
          return (
            <li key={a.id} className={`flex items-center gap-3 py-2.5 ${isUpcoming ? "" : "opacity-60"}`}>
              <input
                type="checkbox"
                checked={a.done}
                onChange={async () => {
                  await saveAssessment(user!.id, { ...a, done: !a.done });
                  load();
                }}
                className="h-4 w-4 accent-[var(--accent)]"
                aria-label={`${a.title} done`}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-ink">{a.title}</p>
                <p className="text-sm text-muted">
                  {describeDue(a.due_date, today).label}
                  {a.weight ? ` · ${a.weight}%` : ""}
                </p>
              </div>
              {isUpcoming && a.due_date > today && (
                <button
                  onClick={() => preview(a)}
                  disabled={busy}
                  className="rounded-lg bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent disabled:opacity-60"
                >
                  Plan my studying
                </button>
              )}
              <button
                onClick={async () => {
                  if (confirm(`Delete ${a.title}?`) && (await deleteAssessment(a.id))) load();
                }}
                className="rounded-lg p-1.5 text-muted hover:text-danger"
                aria-label={`Delete ${a.title}`}
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </li>
          );
        })}
      </ul>

      {plan && (
        <div className="mt-4 rounded-xl border border-accent/30 bg-accent-soft/40 p-3">
          <p className="text-sm font-semibold text-ink">
            {plan.sessions.length} study sessions before {plan.exam.title}
          </p>
          <p className="text-xs text-muted">More sessions close to the exam, in your free time. No AI points used.</p>
          <ul className="mt-2 space-y-1 text-sm">
            {plan.sessions.map((s) => (
              <li key={s.date + s.time} className="flex gap-2 text-ink">
                <span className="w-32 shrink-0 text-muted">
                  {formatDate(s.date)} {s.time}
                </span>
                <span className="min-w-0 flex-1 truncate">{s.title}</span>
                <span className="text-muted">{formatDuration(s.minutes)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setPlan(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={createPlan} disabled={busy}>
              Add to my calendar
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
