import type { Goal } from "@/types/goal";
import type { Progress } from "@/lib/progress";
import ProgressBar from "@/components/ProgressBar";

export default function GoalList({
  goals,
  progressByGoal,
  onEditGoal,
  onDeleteGoal,
}: {
  goals: Goal[];
  progressByGoal: Record<string, Progress>;
  onEditGoal: (goal: Goal) => void;
  onDeleteGoal: (id: string) => void;
}) {
  if (goals.length === 0) {
    return (
      <p className="p-8 text-center text-zinc-500 dark:text-zinc-400">
        No goals yet. Add one to get started.
      </p>
    );
  }

  return (
    <ul className="w-full max-w-2xl space-y-3">
      {goals.map((goal) => (
        <li
          key={goal.id}
          className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="flex items-center justify-between">
            <div
              onClick={() => onEditGoal(goal)}
              className="flex-1 cursor-pointer"
            >
              <p className="font-medium text-black dark:text-white">
                {goal.name}
              </p>
              {goal.target_date && (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Target: {goal.target_date}
                </p>
              )}
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Delete "${goal.name}"?`)) {
                  onDeleteGoal(goal.id);
                }
              }}
              className="rounded-md px-2 py-1 text-sm text-red-500 transition hover:bg-red-50 dark:hover:bg-red-900/20"
            >
              Delete
            </button>
          </div>
          <div className="mt-3">
            <ProgressBar
              progress={
                progressByGoal[goal.id] ?? { done: 0, total: 0, percent: 0 }
              }
            />
          </div>
        </li>
      ))}
    </ul>
  );
}