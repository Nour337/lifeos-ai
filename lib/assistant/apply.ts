import { supabase } from "@/lib/supabaseClient";
import { minutesToTime, timeToMinutes } from "@/utils/date";
import type { ConflictChoice, Proposal } from "@/lib/assistant/types";

export type ApplyResult = {
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
};

// Saves an approved proposal. Runs in the browser as the signed-in user, so
// RLS applies exactly as for manual edits.
export async function applyProposal(
  proposal: Proposal,
  userId: string,
  choices: Record<string, ConflictChoice>
): Promise<ApplyResult> {
  const fail = (what: string, message: string): never => {
    console.error(`Apply failed (${what}):`, message);
    throw new Error(`Couldn't save the ${what}. Nothing after that step was changed.`);
  };

  // 1. New goal and its milestones (milestones are projects under the goal)
  let goalId: string | null = null;
  if (proposal.newGoal) {
    const { data, error } = await supabase
      .from("goals")
      .insert({
        user_id: userId,
        name: proposal.newGoal.name,
        description: proposal.newGoal.description,
        target_date: proposal.newGoal.targetDate,
        progress: 0,
      })
      .select("id")
      .single();
    if (error) fail("goal", error.message);
    goalId = data!.id;
  }

  const milestoneIds = new Map<string, string>();
  for (const milestone of proposal.milestones) {
    const { data, error } = await supabase
      .from("projects")
      .insert({
        user_id: userId,
        name: milestone.name,
        deadline: milestone.deadline,
        goal_id: goalId,
      })
      .select("id")
      .single();
    if (error) fail("milestones", error.message);
    milestoneIds.set(milestone.key, data!.id);
  }

  // 2. New tasks, applying the user's choice for each time conflict
  let skipped = 0;
  const moveExisting: { id: string; start: string; end: string }[] = [];
  const rows = [];
  for (const draft of proposal.creates) {
    let start = draft.start;
    let end = draft.end;
    const choice = draft.conflict ? (choices[draft.key] ?? defaultChoice(draft.conflict)) : null;

    if (choice === "skip") {
      skipped++;
      continue;
    }
    if (choice === "move_new" && draft.conflict?.suggestedStart && start) {
      const shift = timeToMinutes(draft.conflict.suggestedStart) - timeToMinutes(start);
      start = draft.conflict.suggestedStart;
      end = end ? minutesToTime(timeToMinutes(end) + shift) : null;
    }
    if (choice === "move_existing" && draft.conflict?.suggestedStart && draft.conflict.existingTaskId) {
      const c = draft.conflict;
      const length = timeToMinutes(c.existingEnd) - timeToMinutes(c.existingStart);
      moveExisting.push({
        id: c.existingTaskId!,
        start: c.suggestedStart!,
        end: minutesToTime(timeToMinutes(c.suggestedStart!) + length),
      });
    }

    rows.push({
      user_id: userId,
      title: draft.title,
      description: draft.notes,
      due_date: draft.date,
      due_time: start,
      end_time: start ? end : null,
      estimated_duration: draft.duration,
      priority: draft.priority,
      category: draft.category,
      status: "todo",
      goal_id: draft.newGoal ? goalId : draft.goalId,
      project_id: (draft.milestoneKey && milestoneIds.get(draft.milestoneKey)) || draft.projectId,
    });
  }

  if (rows.length) {
    const { error } = await supabase.from("tasks").insert(rows);
    if (error) fail("new tasks", error.message);
  }

  // 3. Changes to existing tasks
  for (const move of moveExisting) {
    const { error } = await supabase
      .from("tasks")
      .update({ due_time: move.start, end_time: move.end, status: "rescheduled" })
      .eq("id", move.id);
    if (error) fail("moved task", error.message);
  }
  for (const update of proposal.updates) {
    const { error } = await supabase.from("tasks").update(update.after).eq("id", update.taskId);
    if (error) fail("task changes", error.message);
  }

  // 4. Deletions
  if (proposal.deletes.length) {
    const { error } = await supabase
      .from("tasks")
      .delete()
      .in(
        "id",
        proposal.deletes.map((d) => d.taskId)
      );
    if (error) fail("deletions", error.message);
  }

  return {
    created: rows.length,
    updated: proposal.updates.length + moveExisting.length,
    deleted: proposal.deletes.length,
    skipped,
  };
}

// Without a choice, move the new task if there's a free slot, else keep both
export function defaultChoice(conflict: { suggestedStart: string | null }): ConflictChoice {
  return conflict.suggestedStart ? "move_new" : "keep_both";
}
