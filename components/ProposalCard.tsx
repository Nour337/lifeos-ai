"use client";

import { useMemo, useState } from "react";
import { defaultChoice } from "@/lib/assistant/apply";
import { Spinner } from "@/components/ui";
import { CheckIcon, TargetIcon, TrashIcon } from "@/components/icons";
import { formatDate } from "@/utils/date";
import { statusLabels } from "@/types/task";
import type { ConflictChoice, DraftTask, Proposal } from "@/lib/assistant/types";

export type ProposalState = "pending" | "applying" | "applied" | "discarded";

const COLLAPSED_DAYS = 5;

const priorityDot: Record<string, string> = {
  high: "bg-danger",
  medium: "bg-warn",
  low: "bg-accent",
};

export default function ProposalCard({
  proposal,
  state,
  onApply,
  onDiscard,
}: {
  proposal: Proposal;
  state: ProposalState;
  onApply: (choices: Record<string, ConflictChoice>) => void;
  onDiscard: () => void;
}) {
  const [choices, setChoices] = useState<Record<string, ConflictChoice>>({});
  const [expanded, setExpanded] = useState(false);
  const locked = state !== "pending";

  const byDay = useMemo(() => {
    const groups = new Map<string, DraftTask[]>();
    for (const draft of [...proposal.creates].sort(
      (a, b) => a.date.localeCompare(b.date) || (a.start ?? "99").localeCompare(b.start ?? "99")
    )) {
      groups.set(draft.date, [...(groups.get(draft.date) ?? []), draft]);
    }
    return [...groups];
  }, [proposal.creates]);

  const conflicts = proposal.creates.filter((d) => d.conflict).length;
  const visibleDays = expanded ? byDay : byDay.slice(0, COLLAPSED_DAYS);

  const applyLabel = [
    proposal.creates.length && `add ${proposal.creates.length}`,
    proposal.updates.length && `change ${proposal.updates.length}`,
    proposal.deletes.length && `delete ${proposal.deletes.length}`,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="mt-2 overflow-hidden rounded-2xl bg-surface shadow-card">
      {proposal.newGoal && (
        <div className="border-b border-line bg-accent-soft/60 p-4">
          <p className="flex items-center gap-2 font-semibold text-ink">
            <TargetIcon className="h-4 w-4 text-accent" />
            New goal: {proposal.newGoal.name}
          </p>
          {proposal.newGoal.targetDate && (
            <p className="mt-0.5 text-sm text-muted">Target {formatDate(proposal.newGoal.targetDate)}</p>
          )}
          {proposal.milestones.length > 0 && (
            <ol className="mt-2 space-y-1">
              {proposal.milestones.map((m, i) => (
                <li key={m.key} className="flex gap-2 text-sm text-ink">
                  <span className="font-semibold text-accent">{i + 1}.</span>
                  <span className="flex-1">{m.name}</span>
                  {m.deadline && <span className="text-muted">{formatDate(m.deadline)}</span>}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {byDay.length > 0 && (
        <div className="p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
            New tasks ({proposal.creates.length})
            {conflicts > 0 && <span className="ml-2 normal-case text-warn">· {conflicts} time conflict{conflicts > 1 && "s"}</span>}
          </p>
          <div className="space-y-3">
            {visibleDays.map(([day, drafts]) => (
              <div key={day}>
                <p className="mb-1 text-sm font-semibold text-ink">{formatDate(day)}</p>
                <ul className="space-y-1">
                  {drafts.map((draft) => (
                    <DraftRow
                      key={draft.key}
                      draft={draft}
                      choice={draft.conflict ? (choices[draft.key] ?? defaultChoice(draft.conflict)) : null}
                      locked={locked}
                      onChoose={(c) => setChoices((prev) => ({ ...prev, [draft.key]: c }))}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {byDay.length > COLLAPSED_DAYS && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-3 text-sm font-medium text-accent hover:underline"
            >
              {expanded ? "Show less" : `Show all ${byDay.length} days`}
            </button>
          )}
        </div>
      )}

      {proposal.updates.length > 0 && (
        <div className="border-t border-line p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
            Changes ({proposal.updates.length})
          </p>
          <ul className="space-y-1.5">
            {proposal.updates.map((u) => (
              <li key={u.taskId} className="text-sm">
                <span className="font-medium text-ink">{u.title}</span>
                <span className="text-muted"> · {describeChange(u)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {proposal.deletes.length > 0 && (
        <div className="border-t border-line p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
            Delete ({proposal.deletes.length})
          </p>
          <ul className="space-y-1">
            {proposal.deletes.map((d) => (
              <li key={d.taskId} className="flex items-center gap-2 text-sm text-danger">
                <TrashIcon className="h-3.5 w-3.5" />
                <span className="line-through">{d.title}</span>
                {d.date && <span className="text-muted">{formatDate(d.date)}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-line bg-surface-2/50 px-4 py-3">
        {state === "applied" && (
          <p className="flex items-center gap-1.5 text-sm font-semibold text-ok">
            <CheckIcon className="h-4 w-4" /> Applied
          </p>
        )}
        {state === "discarded" && <p className="text-sm text-muted">Discarded</p>}
        {(state === "pending" || state === "applying") && (
          <>
            <button
              onClick={onDiscard}
              disabled={state === "applying"}
              className="rounded-xl px-3 py-2 text-sm font-medium text-muted hover:text-ink disabled:opacity-50"
            >
              Discard
            </button>
            <button
              onClick={() => onApply(choices)}
              disabled={state === "applying"}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-grad-from to-grad-to px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-accent/30 disabled:opacity-70"
            >
              {state === "applying" ? <Spinner /> : <CheckIcon className="h-4 w-4" />}
              Apply{applyLabel && ` (${applyLabel})`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function DraftRow({
  draft,
  choice,
  locked,
  onChoose,
}: {
  draft: DraftTask;
  choice: ConflictChoice | null;
  locked: boolean;
  onChoose: (choice: ConflictChoice) => void;
}) {
  const c = draft.conflict;
  const time = draft.start ? `${draft.start}${draft.end ? `–${draft.end}` : ""}` : "Anytime";

  return (
    <li className={`rounded-xl px-3 py-2 ${c ? "bg-warn-soft/70" : "bg-surface-2/60"}`}>
      <div className="flex items-center gap-2.5">
        <span className={`h-2 w-2 shrink-0 rounded-full ${priorityDot[draft.priority]}`} />
        <span className="w-24 shrink-0 text-xs tabular-nums text-muted">{time}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-ink">{draft.title}</span>
      </div>
      {draft.movedFrom && (
        <p className="mt-1 pl-[7.1rem] text-xs text-muted">↪ Moved from {draft.movedFrom}</p>
      )}
      {c && (
        <div className="mt-2 pl-4">
          <p className="text-xs text-warn">
            ⚠️ Overlaps {c.existingTaskId ? "" : "your "}“{c.existingTitle}” ({c.existingStart}–{c.existingEnd})
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {c.suggestedStart && (
              <Choice active={choice === "move_new"} disabled={locked} onClick={() => onChoose("move_new")}>
                Move this to {c.suggestedStart}
              </Choice>
            )}
            {c.suggestedStart && c.existingTaskId && (
              <Choice active={choice === "move_existing"} disabled={locked} onClick={() => onChoose("move_existing")}>
                Move “{c.existingTitle}” to {c.suggestedStart}
              </Choice>
            )}
            <Choice active={choice === "keep_both"} disabled={locked} onClick={() => onChoose("keep_both")}>
              {c.existingTaskId ? "Keep both" : "Keep this time"}
            </Choice>
            <Choice active={choice === "skip"} disabled={locked} onClick={() => onChoose("skip")}>
              Don&apos;t add
            </Choice>
          </div>
        </div>
      )}
    </li>
  );
}

function Choice({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-full px-2.5 py-1 text-xs font-medium transition disabled:cursor-default ${
        active ? "bg-accent text-white" : "bg-surface text-ink shadow-sm hover:bg-accent-soft"
      }`}
    >
      {children}
    </button>
  );
}

function describeChange(u: Proposal["updates"][number]): string {
  const parts: string[] = [];
  const a = u.after;
  if (a.due_date !== undefined) {
    parts.push(
      `${u.before.date ? formatDate(u.before.date) : "no date"} → ${a.due_date ? formatDate(a.due_date) : "no date"}`
    );
  }
  if (a.due_time) parts.push(`at ${a.due_time}${a.end_time ? `–${a.end_time}` : ""}`);
  if (a.status) parts.push(statusLabels[a.status]);
  if (a.priority) parts.push(`${a.priority} priority`);
  if (a.title) parts.push(`renamed to “${a.title}”`);
  return parts.join(", ") || "updated";
}
