import type { Context } from "@/lib/assistant/context";
import { checkProposal, emptyProposal } from "@/lib/assistant/proposal";
import type { Proposal } from "@/lib/assistant/types";
import { doneDate } from "@/lib/persona/insights";
import { loadOf } from "@/lib/schedule";
import { addDays, formatDuration, weekStartOf } from "@/utils/date";
import { isOpen, type Task } from "@/types/task";

// Common requests answered straight from the data: no model call, no AI
// points. Anything that doesn't clearly match goes to the AI.

export type IntentAnswer = { reply: string; proposal: Proposal | null };

const clean = (text: string) =>
  text
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[?!.,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const TODAY = /^(what('?s| is)?|show( me)?|list)( on)?( my)? (schedule|plan|agenda|tasks|day)?( for| on)? today$|^what do i have (to do )?today$|^(my )?(tasks|plan|schedule|agenda) (for )?today$|^today$/;
const TOMORROW = /^(what('?s| is)?|show( me)?|list)( on)?( my)? (schedule|plan|agenda|tasks)?( for| on)? tomorrow$|^what do i have (to do )?tomorrow$|^(my )?(tasks|plan|schedule|agenda) (for )?tomorrow$/;
const DONE_WEEK = /^what (did|have) i (complete|completed|finish|finished|do|done|get done)( so far)? this week$|^(my )?(completed|finished|done) tasks this week$/;
const DONE_TODAY = /^what (did|have) i (complete|completed|finish|finished|do|done|get done)( so far)? today$/;
const MOVE_UNFINISHED = /^(please )?move (all )?(my )?(unfinished|remaining|open|undone|leftover|incomplete) tasks( from today)? to tomorrow$/;

const time = (t: Task) => (t.due_time ? `${t.due_time.slice(0, 5)} – ` : "");

function dayList(ctx: Context, date: string, label: string): string {
  const tasks = ctx.data.tasks
    .filter((t) => t.due_date === date && !t.parent_id)
    .sort((a, b) => (a.due_time ?? "99").localeCompare(b.due_time ?? "99"));
  if (!tasks.length) return `Nothing is planned for ${label} yet. Tell me what you'd like to get done.`;
  const open = tasks.filter(isOpen);
  const load = loadOf(ctx.input, date);
  const lines = tasks.map((t) => `${isOpen(t) ? "•" : t.status === "done" ? "✓" : "–"} ${time(t)}${t.title}`);
  const overload = load.over
    ? `\n\n⚠️ That's ${formatDuration(load.planned)} of work for about ${formatDuration(load.capacity)} of realistic time. Want me to move something?`
    : "";
  return `${label[0].toUpperCase()}${label.slice(1)} you have:\n${lines.join("\n")}\n\n${open.length} of ${tasks.length} still to do.${overload}`;
}

function doneList(ctx: Context, from: string, label: string): string {
  const tz = ctx.data.profile.timezone;
  const done = ctx.data.tasks.filter((t) => {
    const d = doneDate(t, tz);
    return d && d >= from && d <= ctx.today && !t.parent_id;
  });
  if (!done.length) return `You haven't completed anything ${label} yet. Want me to pick the best thing to start with?`;
  const minutes = done.reduce((sum, t) => sum + (t.estimated_duration ?? 30), 0);
  return `You've completed ${done.length} task${done.length > 1 ? "s" : ""} ${label} (about ${formatDuration(minutes)}):\n${done
    .map((t) => `✓ ${t.title}`)
    .join("\n")}`;
}

function moveUnfinished(ctx: Context): IntentAnswer {
  const tomorrow = addDays(ctx.today, 1);
  // Routine sessions aren't carried over: a missed gym day is just missed
  const open = ctx.data.tasks.filter(
    (t) => isOpen(t) && t.due_date && t.due_date <= ctx.today && !t.series_id && !t.is_fixed && !t.parent_id
  );
  if (!open.length) return { reply: "There's nothing unfinished to move. Nice work! 🎉", proposal: null };
  const proposal = emptyProposal(`Move ${open.length} unfinished task${open.length > 1 ? "s" : ""} to tomorrow.`);
  for (const t of open) {
    proposal.updates.push({
      taskId: t.id,
      title: t.title,
      before: { date: t.due_date, start: t.due_time?.slice(0, 5) ?? null, status: t.status },
      after: { due_date: tomorrow },
      warning: null,
    });
  }
  checkProposal(proposal, ctx.input);
  return { reply: `Here's the plan: ${open.length} task${open.length > 1 ? "s" : ""} move to tomorrow, same times.`, proposal };
}

export function answerIntent(ctx: Context, message: string): IntentAnswer | null {
  const text = clean(message);
  if (text.length > 80) return null;
  if (TODAY.test(text)) return { reply: dayList(ctx, ctx.today, "today"), proposal: null };
  if (TOMORROW.test(text)) return { reply: dayList(ctx, addDays(ctx.today, 1), "tomorrow"), proposal: null };
  if (DONE_WEEK.test(text)) return { reply: doneList(ctx, weekStartOf(ctx.today), "this week"), proposal: null };
  if (DONE_TODAY.test(text)) return { reply: doneList(ctx, ctx.today, "today"), proposal: null };
  if (MOVE_UNFINISHED.test(text)) return moveUnfinished(ctx);
  return null;
}
