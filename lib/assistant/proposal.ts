import { describePattern, occurrencesBetween, parsePattern, MAX_OCCURRENCES } from "@/lib/assistant/patterns";
import type { Context } from "@/lib/assistant/context";
import type {
  Conflict,
  DraftSeries,
  DraftTask,
  Proposal,
  SeriesChange,
  TaskChange,
} from "@/lib/assistant/types";
import {
  busyIntervals,
  dayWindow,
  findSlot,
  loadOf,
  overlaps,
  taskInterval,
  type Interval,
  type ScheduleInput,
} from "@/lib/schedule";
import { SERIES_WINDOW_DAYS } from "@/lib/series";
import { addDays, minutesToTime, timeToMinutes } from "@/utils/date";
import { cleanNumber, oneOf, type Importance } from "@/types/persona";
import { PRIORITIES, type Task, type TaskEnergy, type TaskPriority, type TaskStatus } from "@/types/task";

// Turns the AI's propose_changes call into a checked proposal: dates and
// times validated, series expanded for their first weeks, conflicts with
// fixed and flexible time found, and overloaded days flagged. Nothing is
// saved here; the user applies it.

const MAX_CREATES = 150;
const MAX_DAYS_AHEAD = 730;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const STATUSES: TaskStatus[] = ["todo", "in_progress", "done", "skipped"];
const IMPORTANCE = ["low", "medium", "high", "very_high"] as const;

type Args = Record<string, unknown>;

const str = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const date = (v: unknown) => (typeof v === "string" && DATE.test(v) ? v : null);
const time = (v: unknown) => {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, 5).padStart(5, "0"); // "9:00" -> "09:00"
  return TIME.test(t) ? t : null;
};
const minutes = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 && n <= 24 * 60 ? n : null;
};
const array = (v: unknown): Args[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);
const priority = (v: unknown): TaskPriority => (PRIORITIES.includes(v as TaskPriority) ? (v as TaskPriority) : "medium");
const energy = (v: unknown): TaskEnergy | null => (v === "deep" || v === "light" ? v : null);

export function newProposalId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function emptyProposal(summary: string): Proposal {
  return {
    id: newProposalId(),
    summary,
    assumptions: [],
    newGoal: null,
    milestones: [],
    series: [],
    creates: [],
    updates: [],
    seriesChanges: [],
    deletes: [],
    overloaded: [],
  };
}

export function isEmpty(p: Proposal): boolean {
  return (
    !p.newGoal &&
    !p.series.length &&
    !p.creates.length &&
    !p.updates.length &&
    !p.seriesChanges.length &&
    !p.deletes.length
  );
}

export function buildProposal(args: Args, ctx: Context): Proposal | null {
  const today = ctx.today;
  const lastDay = addDays(today, MAX_DAYS_AHEAD);
  const inRange = (d: string | null) => (d && d >= today && d <= lastDay ? d : null);

  const proposal = emptyProposal(str(args.summary, 600) ?? "Here's my plan.");
  proposal.assumptions = (Array.isArray(args.assumptions) ? args.assumptions : [])
    .map((a) => str(a, 120))
    .filter((a): a is string => !!a)
    .slice(0, 6);

  const g = (args.new_goal ?? null) as Args | null;
  const goalName = str(g?.name, 120);
  if (g && goalName) {
    proposal.newGoal = {
      name: goalName,
      description: str(g.description, 500),
      targetDate: inRange(date(g.target_date)),
      why: str(g.why, 300),
      priority: (oneOf(g.priority, IMPORTANCE) ?? null) as Importance | null,
      weeklyHours: cleanNumber(g.weekly_hours, 0, 100) ?? null,
    };
  }

  proposal.milestones = array(args.milestones)
    .map((m) => ({ key: str(m.key, 20) ?? "", name: str(m.name, 120) ?? "", deadline: inRange(date(m.deadline)) }))
    .filter((m) => m.key && m.name)
    .slice(0, 8)
    // A milestone can't be due after the goal itself
    .map((m) =>
      proposal.newGoal?.targetDate && m.deadline && m.deadline > proposal.newGoal.targetDate
        ? { ...m, deadline: proposal.newGoal.targetDate }
        : m
    );
  const milestoneKeys = new Set(proposal.milestones.map((m) => m.key));

  // Shared fields of one-off tasks and series
  const base = (raw: Args) => {
    const start = time(raw.start_time);
    const end = start ? time(raw.end_time) : null;
    const span = start && end ? timeToMinutes(end) - timeToMinutes(start) : null;
    const goalRaw = str(raw.goal, 10);
    const milestone = str(raw.milestone, 20);
    return {
      title: str(raw.title, 150) ?? "",
      notes: str(raw.notes, 500),
      start,
      end: span && span > 0 ? end : null,
      duration: span && span > 0 ? span : minutes(raw.duration_minutes),
      priority: priority(raw.priority),
      category: str(raw.category, 40),
      energy: energy(raw.energy),
      goalId: (goalRaw && ctx.goalRef.get(goalRaw)?.id) ?? null,
      newGoal: goalRaw === "new" && !!proposal.newGoal,
      projectId: ctx.projectRef.get(str(raw.project, 10) ?? "")?.id ?? null,
      milestoneKey: milestone && milestoneKeys.has(milestone) ? milestone : null,
    };
  };

  const push = (fields: ReturnType<typeof base>, day: string, extra: Partial<DraftTask> = {}) => {
    if (!fields.title || day < today || proposal.creates.length >= MAX_CREATES) return;
    proposal.creates.push({
      key: `n${proposal.creates.length}`,
      date: day,
      conflict: null,
      movedFrom: null,
      isFixed: false,
      seriesKey: null,
      ...fields,
      ...extra,
    });
  };

  for (const raw of array(args.tasks)) {
    const day = inRange(date(raw.date));
    if (day) push(base(raw), day, { isFixed: raw.fixed === true });
  }

  for (const [i, raw] of array(args.series).entries()) {
    const pattern = parsePattern(raw.pattern);
    const start = date(raw.start_date);
    if (!pattern || !start) continue;
    const fields = base(raw);
    if (!fields.title) continue;
    const count = Math.min(Math.round(Number(raw.count)) || 0, 1000) || null;
    const startDate = start < today ? today : start;
    let until = inRange(date(raw.until));
    // Every series needs an end or a count; without one, it runs for four weeks
    if (!count && !until) until = addDays(startDate, 27);
    const series: DraftSeries = {
      key: `s${i}`,
      title: fields.title,
      notes: fields.notes,
      pattern,
      patternLabel: describePattern(pattern),
      startDate,
      until,
      count,
      totalSessions: null,
      start: fields.start,
      end: fields.end,
      duration: fields.duration,
      priority: fields.priority,
      category: fields.category,
      energy: fields.energy,
      goalId: fields.goalId,
      newGoal: fields.newGoal,
      projectId: fields.projectId,
      milestoneKey: fields.milestoneKey,
      isRoutine: raw.routine === true,
    };
    const rule = { pattern, start_date: startDate, until, count };
    series.totalSessions = occurrencesBetween(rule, startDate, until ?? addDays(startDate, 365 * 2)).length || null;
    proposal.series.push(series);
    // Only the first weeks become tasks now
    const windowEnd = addDays(today, SERIES_WINDOW_DAYS);
    for (const day of occurrencesBetween(rule, startDate, windowEnd).slice(0, MAX_OCCURRENCES)) {
      push(fields, day, { seriesKey: series.key });
    }
  }

  for (const raw of array(args.updates)) {
    const task = ctx.taskRef.get(str(raw.task, 10) ?? "");
    if (!task) continue;
    const after: TaskChange["after"] = {};
    if (raw.date === "none") after.due_date = null;
    else if (inRange(date(raw.date))) after.due_date = date(raw.date);
    const start = time(raw.start_time);
    const end = time(raw.end_time);
    if (raw.start_time === "none") {
      after.due_time = null;
      after.end_time = null;
    } else if (start) after.due_time = start;
    if (end) after.end_time = end;
    if (start && end && timeToMinutes(end) > timeToMinutes(start)) {
      after.estimated_duration = timeToMinutes(end) - timeToMinutes(start);
    } else if (minutes(raw.duration_minutes)) {
      after.estimated_duration = minutes(raw.duration_minutes);
      // Keep the end time consistent with the new length
      const s = start ?? (task.due_time ? task.due_time.slice(0, 5) : null);
      if (s && !end) after.end_time = minutesToTime(timeToMinutes(s) + after.estimated_duration!);
    }
    if (STATUSES.includes(raw.status as TaskStatus)) after.status = raw.status as TaskStatus;
    if (PRIORITIES.includes(raw.priority as TaskPriority)) after.priority = raw.priority as TaskPriority;
    if (str(raw.title, 150)) after.title = str(raw.title, 150)!;
    // A moved start keeps the task's length
    if (start && !end && after.estimated_duration === undefined && task.due_time && task.end_time) {
      const length = timeToMinutes(task.end_time) - timeToMinutes(task.due_time);
      if (length > 0) after.end_time = minutesToTime(timeToMinutes(start) + length);
    }
    if (Object.keys(after).length === 0) continue;
    proposal.updates.push({
      taskId: task.id,
      title: task.title,
      before: { date: task.due_date, start: task.due_time?.slice(0, 5) ?? null, status: task.status },
      after,
      warning: null,
    });
  }

  for (const raw of array(args.series_changes)) {
    const series = ctx.seriesRef.get(str(raw.series, 10) ?? "");
    if (!series) continue;
    const from = inRange(date(raw.from_date)) ?? today;
    if (raw.action === "stop") {
      proposal.seriesChanges.push({
        seriesId: series.id,
        title: series.title,
        action: "stop",
        fromDate: from,
        changes: {},
        label: `Stop "${series.title}" from ${from}`,
      });
      continue;
    }
    const changes: SeriesChange["changes"] = {};
    const title = str(raw.title, 150);
    if (title) changes.title = title;
    const start = time(raw.start_time);
    const end = time(raw.end_time);
    if (start) changes.due_time = start;
    if (end) changes.end_time = end;
    if (minutes(raw.duration_minutes)) changes.estimated_duration = minutes(raw.duration_minutes);
    const pattern = parsePattern(raw.pattern);
    if (pattern) changes.pattern = pattern;
    if (!Object.keys(changes).length) continue;
    const parts = [
      changes.title && `rename to "${changes.title}"`,
      changes.due_time && `at ${changes.due_time}`,
      changes.estimated_duration && `${changes.estimated_duration} min`,
      changes.pattern && describePattern(changes.pattern),
    ].filter(Boolean);
    proposal.seriesChanges.push({
      seriesId: series.id,
      title: series.title,
      action: "change",
      fromDate: from,
      changes,
      label: `"${series.title}" from ${from}: ${parts.join(", ")}`,
    });
  }

  proposal.deletes = (Array.isArray(args.deletes) ? args.deletes : [])
    .map((ref) => ctx.taskRef.get(String(ref)))
    .filter((t): t is Task => !!t)
    .map((t) => ({ taskId: t.id, title: t.title, date: t.due_date }));

  if (isEmpty(proposal)) return null;
  checkProposal(proposal, ctx.input);
  return proposal;
}

// ---------------------------------------------------------------- checks

// The schedule as it will look after the proposal: removed and moved tasks
// taken out, updated ones placed at their new time
function afterProposal(proposal: Proposal, input: ScheduleInput): ScheduleInput {
  const removed = new Set(proposal.deletes.map((d) => d.taskId));
  const changed = new Map(proposal.updates.map((u) => [u.taskId, u.after]));
  const stoppedSeries = new Map(proposal.seriesChanges.map((c) => [c.seriesId, c.fromDate]));
  const tasks = input.tasks
    .filter((t) => !removed.has(t.id))
    .filter((t) => !(t.series_id && stoppedSeries.has(t.series_id) && (t.occurrence_date ?? "") >= stoppedSeries.get(t.series_id)!))
    .map((t) => (changed.has(t.id) ? ({ ...t, ...changed.get(t.id) } as Task) : t));
  return { ...input, tasks };
}

function asTask(draft: DraftTask): Task {
  return {
    id: `draft-${draft.key}`,
    title: draft.title,
    due_date: draft.date,
    due_time: draft.start,
    end_time: draft.end,
    estimated_duration: draft.duration,
    status: "todo",
    parent_id: null,
    is_fixed: draft.isFixed,
  } as Task;
}

const label = (b: Interval) => `${b.label} ${minutesToTime(b.start)}–${b.end >= 1440 ? "24:00" : minutesToTime(b.end)}`;

// Flags conflicts and overloaded days, and moves new tasks out of fixed
// busy time (work and university can't move) to the nearest free slot.
export function checkProposal(proposal: Proposal, baseInput: ScheduleInput): void {
  const input = afterProposal(proposal, baseInput);
  const window = dayWindow(input.schedule);

  for (const draft of proposal.creates) {
    if (!draft.start) {
      input.tasks.push(asTask(draft));
      continue;
    }
    const length = taskInterval(asTask(draft))!;
    let span = { start: length.start, end: length.end };
    const busy = busyIntervals(input, draft.date);

    const fixedClash = busy.find((b) => b.fixed && overlaps(b, span));
    if (fixedClash && !draft.isFixed) {
      const size = span.end - span.start;
      const slot = findSlot(busy, fixedClash.end, size, window.end) ?? findSlot(busy, window.start, size, window.end);
      if (slot !== null) {
        const shift = slot - span.start;
        draft.movedFrom = `${draft.start} (${fixedClash.label})`;
        draft.start = minutesToTime(slot);
        if (draft.end) draft.end = minutesToTime(timeToMinutes(draft.end) + shift);
        span = { start: slot, end: slot + size };
      }
    }

    const clash = busy.find((b) => overlaps(b, span));
    if (clash) {
      draft.conflict = {
        existingTaskId: clash.taskId ?? null,
        existingTitle: clash.label,
        existingStart: minutesToTime(clash.start),
        existingEnd: clash.end >= 1440 ? "23:59" : minutesToTime(clash.end),
        existingFixed: clash.fixed,
        suggestedStart: (() => {
          const slot = findSlot(busy, clash.end, span.end - span.start, window.end);
          return slot === null ? null : minutesToTime(slot);
        })(),
      } satisfies Conflict;
    }
    // Later new tasks must also avoid this one
    input.tasks.push(asTask(draft));
  }

  // Updated tasks moved onto busy time get a warning (the user sees it before applying)
  for (const update of proposal.updates) {
    const task = input.tasks.find((t) => t.id === update.taskId);
    if (!task?.due_date || !task.due_time || task.status === "done" || task.status === "skipped") continue;
    if (update.after.due_date === undefined && update.after.due_time === undefined) continue;
    const span = taskInterval(task)!;
    const clash = busyIntervals(input, task.due_date, new Set([task.id])).find((b) => overlaps(b, span));
    if (clash) update.warning = `Overlaps ${label(clash)}`;
  }

  // Days pushed over capacity by this plan
  const days = new Set([
    ...proposal.creates.map((c) => c.date),
    ...proposal.updates.map((u) => u.after.due_date).filter((d): d is string => !!d),
  ]);
  proposal.overloaded = [...days]
    .sort()
    .map((day) => ({ date: day, ...loadOf(input, day) }))
    .filter((l) => l.over && l.capacity > 0)
    .slice(0, 7)
    .map((l) => ({ date: l.date, planned: l.planned, capacity: l.capacity }));
}
