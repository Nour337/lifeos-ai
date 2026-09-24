"use client";

import { addDays, getWeekDays } from "@/utils/date";

const weekdayLetters = ["M", "T", "W", "T", "F", "S", "S"];

// Mon–Sun row of day circles. The selected day is filled; days with open
// tasks get a dot; ‹ › move a week at a time.
export default function WeekStrip({
  selected,
  today,
  busyDays,
  onSelect,
}: {
  selected: string;
  today: string;
  busyDays: Set<string>;
  onSelect: (date: string) => void;
}) {
  const days = getWeekDays(selected);

  return (
    <div className="flex items-center gap-1">
      <WeekArrow direction="prev" onClick={() => onSelect(addDays(selected, -7))} />
      <div className="grid flex-1 grid-cols-7 gap-1">
        {days.map((date, i) => {
          const isSelected = date === selected;
          const isToday = date === today;
          return (
            <button
              key={date}
              onClick={() => onSelect(date)}
              aria-pressed={isSelected}
              aria-label={date}
              className="flex flex-col items-center gap-1.5"
            >
              <span className="text-xs font-medium text-muted">{weekdayLetters[i]}</span>
              <span
                className={`flex h-10 w-10 items-center justify-center rounded-full text-[15px] font-semibold transition ${
                  isSelected
                    ? "bg-gradient-to-br from-grad-from to-grad-to text-white shadow-md shadow-accent/30"
                    : isToday
                      ? "bg-surface text-accent shadow-card ring-2 ring-accent/30"
                      : "bg-surface text-ink shadow-card hover:ring-2 hover:ring-accent/20"
                }`}
              >
                {Number(date.slice(8))}
              </span>
              <span
                className={`h-1 w-1 rounded-full ${
                  busyDays.has(date) && !isSelected ? "bg-accent" : "bg-transparent"
                }`}
              />
            </button>
          );
        })}
      </div>
      <WeekArrow direction="next" onClick={() => onSelect(addDays(selected, 7))} />
    </div>
  );
}

function WeekArrow({
  direction,
  onClick,
}: {
  direction: "prev" | "next";
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={direction === "prev" ? "Previous week" : "Next week"}
      className="-mt-3 flex h-8 w-6 items-center justify-center rounded-lg text-muted transition hover:text-ink"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d={direction === "prev" ? "M15 18l-6-6 6-6" : "M9 6l6 6-6 6"} />
      </svg>
    </button>
  );
}
