import { supabase } from "@/lib/supabaseClient";
import { ensureOccurrences } from "@/lib/series";
import { updateAIProfile } from "@/lib/queries/persona";
import { minutesToTime, timeToMinutes, toLocalDateString } from "@/utils/date";
import type { ConflictChoice, PersonaUndo, Proposal } from "@/lib/assistant/types";
import type { AIProfile } from "@/types/persona";

export type ApplyResult = {
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
};

// Without a choice, move the new task if there's a free slot, else keep both
export function defaultChoice(conflict: { suggestedStart: string | null }): ConflictChoice {
  return conflict.suggestedStart ? "move_new" : "keep_both";
}

// Builds the payload for apply_proposal from the approved proposal and the
// user's choice for each time conflict.
function payload(proposal: Proposal, choices: Record<string, ConflictChoice>) {
  let skipped = 0;
  const moves: { id: string; due_time: string; end_time: string }[] = [];
  const creates = [];

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
    if (
      choice === "move_existing" &&
      draft.conflict?.suggestedStart &&
      draft.conflict.existingTaskId &&
      !draft.conflict.existingFixed
    ) {
      const c = draft.conflict;
      const length = timeToMinutes(c.existingEnd) - timeToMinutes(c.existingStart);
      moves.push({
        id: c.existingTaskId!,
        due_time: c.suggestedStart!,
        end_time: minutesToTime(timeToMinutes(c.suggestedStart!) + length),
      });
    }

    creates.push({
      title: draft.title,
      description: draft.notes,
      due_date: draft.date,
      due_time: start,
      end_time: start ? end : null,
      estimated_duration: draft.duration,
      priority: draft.priority,
      category: draft.category,
      energy: draft.energy,
      is_fixed: draft.isFixed,
      project_id: draft.projectId,
      goal_id: draft.goalId,
      new_goal: draft.newGoal,
      milestone_key: draft.milestoneKey,
      series_key: draft.seriesKey,
      occurrence_date: draft.seriesKey ? draft.date : null,
    });
  }

  return {
    skipped,
    body: {
      new_goal: proposal.newGoal
        ? {
            name: proposal.newGoal.name,
            description: proposal.newGoal.description,
            target_date: proposal.newGoal.targetDate,
            why: proposal.newGoal.why,
            priority: proposal.newGoal.priority,
            weekly_hours: proposal.newGoal.weeklyHours,
          }
        : null,
      milestones: proposal.milestones,
      series: proposal.series.map((s) => ({
        key: s.key,
        title: s.title,
        description: s.notes,
        pattern: s.pattern,
        start_date: s.startDate,
        until: s.until,
        count: s.count,
        due_time: s.start,
        end_time: s.start ? s.end : null,
        estimated_duration: s.duration,
        priority: s.priority,
        category: s.category,
        energy: s.energy,
        project_id: s.projectId,
        goal_id: s.goalId,
        new_goal: s.newGoal,
        milestone_key: s.milestoneKey,
        is_routine: s.isRoutine,
      })),
      creates,
      moves,
      updates: proposal.updates.map((u) => ({ id: u.taskId, changes: u.after })),
      series_changes: proposal.seriesChanges.map((c) => ({
        id: c.seriesId,
        action: c.action,
        from_date: c.fromDate,
        changes: c.changes,
      })),
      deletes: proposal.deletes.map((d) => d.taskId),
    },
  };
}

// Saves an approved proposal in one transaction (apply_proposal): either
// everything is saved or nothing is. The proposal id makes it safe to press
// Apply twice. Runs as the signed-in user, so row level security applies.
export async function applyProposal(
  proposal: Proposal,
  choices: Record<string, ConflictChoice>,
  messageId?: number
): Promise<ApplyResult> {
  const { skipped, body } = payload(proposal, choices);
  const { data, error } = await supabase.rpc("apply_proposal", { p_key: proposal.id, p_payload: body });
  if (error) {
    console.error("Apply failed:", error.message);
    throw new Error("Couldn't save the plan. Nothing was changed; try again.");
  }

  // Routines: create their sessions beyond the first weeks / from the new rule
  if (proposal.series.length || proposal.seriesChanges.length) {
    await ensureOccurrences(supabase, toLocalDateString()).catch(() => 0);
  }
  if (messageId) {
    await supabase.from("messages").update({ proposal_state: "applied" }).eq("id", messageId);
  }

  const result = (data ?? {}) as { created?: number; updated?: number; deleted?: number };
  return {
    created: result.created ?? 0,
    updated: result.updated ?? 0,
    deleted: result.deleted ?? 0,
    skipped,
  };
}

export async function discardProposal(messageId: number): Promise<void> {
  await supabase.from("messages").update({ proposal_state: "discarded" }).eq("id", messageId);
}

// Undo what the AI learned in one reply: previous persona values come back,
// records it changed are restored, records it created are removed.
export async function undoPersonaChanges(userId: string, undo: PersonaUndo, messageId?: number): Promise<boolean> {
  let ok = true;
  if (Object.keys(undo.profile).length) {
    const saved = await updateAIProfile(userId, (current) => ({ ...current, ...(undo.profile as Partial<AIProfile>) }));
    ok = !!saved;
  }
  for (const row of [...undo.rows].reverse()) {
    const { error } = row.before
      ? await supabase.from(row.table).update(row.before).eq("id", row.id)
      : await supabase.from(row.table).delete().eq("id", row.id);
    if (error) ok = false;
  }
  if (ok && messageId) {
    const { data } = await supabase.from("messages").select("remembered").eq("id", messageId).maybeSingle();
    if (data?.remembered) {
      await supabase
        .from("messages")
        .update({ remembered: { ...data.remembered, undone: true } })
        .eq("id", messageId);
    }
  }
  return ok;
}
