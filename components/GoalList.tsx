"use client";

import ProgressBar from "@/components/ProgressBar";
import { CalendarIcon, FolderIcon, PencilIcon, TrashIcon } from "@/components/icons";
import { formatDate } from "@/utils/date";
import type { Goal } from "@/types/goal";
import type { Progress } from "@/lib/progress";

const emptyProgress: Progress = { done: 0, total: 0, percent: 0 };

export default function GoalList({
  goals,
  progressByGoal,
  projectCounts = {},
  onEditGoal,
  onDeleteGoal,
}: {
  goals: Goal[];
  progressByGoal: Record<string, Progress>;
  projectCounts?: Record<string, number>;
  onEditGoal: (goal: Goal) => void;
  onDeleteGoal: (id: string) => void;
}) {
  return (
    <ul className="space-y-3">
      {goals.map((goal) => {
        const projectCount = projectCounts[goal.id] ?? 0;
        return (
          <li
            key={goal.id}
            className="group rounded-2xl bg-surface p-4 shadow-card sm:p-5"
          >
            <div className="flex items-start justify-between gap-2">
              <button
                onClick={() => onEditGoal(goal)}
                className="min-w-0 flex-1 text-left"
              >
                <p className="text-lg font-semibold text-ink">{goal.name}</p>
                {goal.description && (
                  <p className="mt-0.5 line-clamp-2 text-sm text-muted">
                    {goal.description}
                  </p>
                )}
              </button>
              <div className="-mr-1 -mt-1 flex opacity-70 transition group-hover:opacity-100">
                <button
                  onClick={() => onEditGoal(goal)}
                  className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink"
                  aria-label={`Edit "${goal.name}"`}
                >
                  <PencilIcon className="h-4 w-4" />
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Delete "${goal.name}"?`)) onDeleteGoal(goal.id);
                  }}
                  className="rounded-lg p-1.5 text-muted hover:bg-danger-soft hover:text-danger"
                  aria-label={`Delete "${goal.name}"`}
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
              {goal.target_date && (
                <span className="flex items-center gap-1">
                  <CalendarIcon className="h-3.5 w-3.5" />
                  Target {formatDate(goal.target_date)}
                </span>
              )}
              <span className="flex items-center gap-1">
                <FolderIcon className="h-3.5 w-3.5" />
                {projectCount} {projectCount === 1 ? "project" : "projects"}
              </span>
            </div>

            <div className="mt-4">
              <ProgressBar progress={progressByGoal[goal.id] ?? emptyProgress} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
