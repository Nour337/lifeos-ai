"use client";

import { useState } from "react";
import { getWeekDays } from "@/utils/date";
import { isDone, type Task } from "@/types/task";

const LETTERS = ["M", "T", "W", "T", "F", "S", "S"];
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CHART_HEIGHT = 96; // px

// Tasks completed per day this week: one series, one hue, bars grow from
// the baseline. Hover or tap a bar for the exact numbers.
export default function WeeklyProgress({
  tasks,
  weekOf,
  today,
}: {
  tasks: Task[];
  weekOf: string;
  today: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const days = getWeekDays(weekOf).map((date) => {
    const dayTasks = tasks.filter((t) => t.due_date === date && t.status !== "skipped");
    return { date, total: dayTasks.length, done: dayTasks.filter(isDone).length };
  });

  const done = days.reduce((sum, d) => sum + d.done, 0);
  const total = days.reduce((sum, d) => sum + d.total, 0);
  const max = Math.max(1, ...days.map((d) => d.done));
  const percent = total ? Math.round((done / total) * 100) : 0;

  return (
    <section className="rounded-2xl bg-surface p-4 shadow-card sm:p-5">
      <div className="mb-4 flex items-baseline justify-between gap-2">
        <h2 className="font-semibold text-ink">This week</h2>
        <p className="text-sm text-muted">
          <span className="font-semibold text-ink">{done}</span> of {total} done
          {total > 0 && ` · ${percent}%`}
        </p>
      </div>

      <div className="relative grid grid-cols-7 gap-2" style={{ height: CHART_HEIGHT + 22 }}>
        {days.map((day, i) => {
          const height = day.done ? Math.max((day.done / max) * CHART_HEIGHT, 6) : 0;
          const isToday = day.date === today;
          const label = `${DAY_NAMES[i]}: ${day.done} of ${day.total} done`;
          return (
            <button
              key={day.date}
              type="button"
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(i)}
              onBlur={() => setHovered(null)}
              onClick={() => setHovered((h) => (h === i ? null : i))}
              aria-label={label}
              className="group relative flex h-full flex-col items-center justify-end"
            >
              {/* The hit target is the whole column, bigger than the bar */}
              <span className="flex w-full flex-1 items-end justify-center">
                <span
                  className={`w-full max-w-7 rounded-t-[4px] transition-all ${
                    day.done ? "bg-accent" : ""
                  } ${hovered === i ? "brightness-110" : ""}`}
                  style={{ height }}
                />
              </span>
              {/* Baseline */}
              <span className="h-px w-full bg-line" />
              <span
                className={`mt-1.5 text-xs ${isToday ? "font-bold text-ink" : "text-muted"}`}
              >
                {LETTERS[i]}
              </span>

              {hovered === i && (
                <span className="pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-xs text-bg shadow-lg">
                  {label}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Same numbers as a table, for screen readers */}
      <table className="sr-only">
        <caption>Tasks completed per day this week</caption>
        <thead>
          <tr>
            <th>Day</th>
            <th>Done</th>
            <th>Planned</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day, i) => (
            <tr key={day.date}>
              <td>{DAY_NAMES[i]}</td>
              <td>{day.done}</td>
              <td>{day.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
