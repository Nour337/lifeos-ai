import type { Progress } from "@/lib/progress";

export default function ProgressBar({ progress }: { progress: Progress }) {
  return (
    <div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
        <div
          className="h-full bg-black transition-all dark:bg-white"
          style={{ width: `${progress.percent}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {progress.total === 0
          ? "No tasks yet"
          : `${progress.percent}% complete · ${progress.done}/${progress.total} tasks`}
      </p>
    </div>
  );
}
