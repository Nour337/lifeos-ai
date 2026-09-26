import { addDays, daysBetween } from "@/utils/date";
import { place, reserve, type ScheduleInput } from "@/lib/schedule";
import type { AIProfile } from "@/types/persona";
import type { Assessment, Project } from "@/types/project";

// Exam mode: turns an exam date into spaced study sessions, more of them
// close to the exam, placed in free time (busy hours, rest days and daily
// capacity respected). No AI needed. When a session is missed, the recovery
// card moves it to a free slot before the exam (lib/recovery.ts).

export type StudySession = {
  title: string;
  date: string;
  time: string;
  minutes: number;
};

const SESSIONS_BY_DIFFICULTY = { easy: 4, medium: 6, hard: 8 } as const;

// Days before the exam to study on, most important last
const OFFSETS = [28, 21, 14, 10, 8, 6, 5, 4, 3, 2, 1];

export function planStudySessions(
  course: Project,
  exam: Assessment,
  input: ScheduleInput,
  profile: AIProfile | null,
  today: string,
  nowMinutes: number
): StudySession[] {
  const daysLeft = daysBetween(today, exam.due_date);
  if (daysLeft < 1) return [];
  const wanted = Math.min(
    SESSIONS_BY_DIFFICULTY[course.difficulty ?? "medium"] + (exam.weight && exam.weight >= 30 ? 2 : 0),
    daysLeft
  );
  const minutes = profile?.preferences.durations?.study ?? (profile?.preferences.session === "short" ? 45 : 90);

  // Spread over the available days, denser near the exam
  const offsets = OFFSETS.filter((o) => o <= daysLeft).slice(-wanted);
  const working: ScheduleInput = { ...input, tasks: [...input.tasks] };
  const sessions: StudySession[] = [];

  offsets.forEach((offset, i) => {
    const target = addDays(exam.due_date, -offset);
    const lastDay = addDays(exam.due_date, -1);
    const slot =
      place(working, minutes, {
        fromDate: target < today ? today : target,
        toDate: lastDay,
        notBefore: target <= today ? nowMinutes : 0,
      }) ?? null;
    if (!slot) return;
    const final = i >= offsets.length - 2;
    sessions.push({
      title: final ? `${course.name}: practice exam & review` : `Study ${course.name} (${i + 1}/${offsets.length})`,
      date: slot.date,
      time: slot.time,
      minutes,
    });
    reserve(working, slot.date, slot.time, minutes, course.name);
  });
  return sessions;
}
