"use client";

import { SearchIcon } from "@/components/icons";
import { Select } from "@/components/ui";

export type TaskFilterState = {
  status: string;
  priority: string;
  category: string;
  search: string;
};

const statusOptions = [
  { value: "all", label: "All" },
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
  { value: "rescheduled", label: "Rescheduled" },
  { value: "skipped", label: "Skipped" },
];

export default function TaskFilters({
  filters,
  categories = [],
  onChange,
}: {
  filters: TaskFilterState;
  categories?: string[];
  onChange: (filters: TaskFilterState) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            placeholder="Search tasks"
            value={filters.search}
            onChange={(e) => onChange({ ...filters, search: e.target.value })}
            className="w-full rounded-xl border border-line bg-surface py-2.5 pl-9 pr-3 text-[15px] text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/20"
          />
        </div>
        <Select
          value={filters.priority}
          onChange={(e) => onChange({ ...filters, priority: e.target.value })}
          className="w-auto! pr-8"
          aria-label="Filter by priority"
        >
          <option value="all">Any priority</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </Select>
        {categories.length > 0 && (
          <Select
            value={filters.category}
            onChange={(e) => onChange({ ...filters, category: e.target.value })}
            className="hidden w-auto! pr-8 sm:block"
            aria-label="Filter by category"
          >
            <option value="all">Any category</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        )}
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {statusOptions.map((option) => {
          const active = filters.status === option.value;
          return (
            <button
              key={option.value}
              onClick={() => onChange({ ...filters, status: option.value })}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
                active
                  ? "border-transparent bg-accent text-white shadow-sm shadow-accent/30"
                  : "border-transparent bg-surface text-muted shadow-card hover:text-ink"
              }`}
            >
              {option.label}
            </button>
          );
        })}
        {/* On phones categories are chips in the same row */}
        {categories.map((c) => {
          const active = filters.category === c;
          return (
            <button
              key={c}
              onClick={() =>
                onChange({ ...filters, category: active ? "all" : c })
              }
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition sm:hidden ${
                active
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-dashed border-line text-muted"
              }`}
            >
              {c}
            </button>
          );
        })}
      </div>
    </div>
  );
}
