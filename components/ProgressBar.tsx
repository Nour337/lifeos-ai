import type { Progress } from "@/lib/progress";

export default function ProgressBar({ progress }: { progress: Progress }) {
  const complete = progress.manual ? progress.percent >= 100 : progress.total > 0 && progress.done === progress.total;
  return (
    <div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            complete ? "bg-ok" : "bg-gradient-to-r from-grad-from to-grad-to"
          }`}
          style={{ width: `${progress.percent}%` }}
        />
      </div>
      <p className="mt-1.5 flex justify-between text-xs text-muted">
        {progress.manual ? (
          <>
            <span>Your estimate</span>
            <span className="font-medium text-ink">{progress.percent}%</span>
          </>
        ) : progress.total === 0 ? (
          <span>No tasks yet</span>
        ) : (
          <>
            <span>
              {progress.done} of {progress.total} tasks
            </span>
            <span className="font-medium text-ink">{progress.percent}%</span>
          </>
        )}
      </p>
    </div>
  );
}
