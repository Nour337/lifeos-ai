"use client";

import Link from "next/link";
import ProgressBar from "@/components/ProgressBar";
import { CalendarIcon, PencilIcon, TargetIcon, TrashIcon } from "@/components/icons";
import { formatDate } from "@/utils/date";
import { kindOf, type Project } from "@/types/project";
import type { Progress } from "@/lib/progress";

const emptyProgress: Progress = { done: 0, total: 0, percent: 0 };

export default function ProjectList({
  projects,
  progressByProject,
  goalNames = {},
  onEditProject,
  onDeleteProject,
}: {
  projects: Project[];
  progressByProject: Record<string, Progress>;
  goalNames?: Record<string, string>;
  onEditProject: (project: Project) => void;
  onDeleteProject: (id: string) => void;
}) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {projects.map((project) => {
        const goalName = project.goal_id ? goalNames[project.goal_id] : null;
        return (
          <li
            key={project.id}
            className="group relative flex flex-col rounded-2xl bg-surface p-4 shadow-card transition hover:ring-2 hover:ring-accent/20"
          >
            <div className="flex items-start justify-between gap-2">
              <Link
                href={`/projects/${project.id}`}
                className="min-w-0 flex-1 after:absolute after:inset-0 after:rounded-2xl"
              >
                <p className="truncate font-semibold text-ink">
                  <span className="mr-1.5" title={kindOf(project.kind).label} aria-hidden="true">
                    {kindOf(project.kind).emoji}
                  </span>
                  {project.name}
                </p>
              </Link>
              {/* z-10 keeps the buttons clickable above the card-wide link */}
              <div className="relative z-10 -mr-1 -mt-1 flex opacity-70 transition group-hover:opacity-100">
                <button
                  onClick={() => onEditProject(project)}
                  className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink"
                  aria-label={`Edit "${project.name}"`}
                >
                  <PencilIcon className="h-4 w-4" />
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Delete "${project.name}"?`)) {
                      onDeleteProject(project.id);
                    }
                  }}
                  className="rounded-lg p-1.5 text-muted hover:bg-danger-soft hover:text-danger"
                  aria-label={`Delete "${project.name}"`}
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
            </div>

            {project.description && (
              <p className="mt-1 line-clamp-2 text-sm text-muted">
                {project.description}
              </p>
            )}

            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
              {project.deadline && (
                <span className="flex items-center gap-1">
                  <CalendarIcon className="h-3.5 w-3.5" />
                  {project.kind === "course" ? "Exam " : ""}
                  {formatDate(project.deadline)}
                </span>
              )}
              {goalName && (
                <span className="flex items-center gap-1">
                  <TargetIcon className="h-3.5 w-3.5" />
                  {goalName}
                </span>
              )}
            </div>

            <div className="mt-auto pt-4">
              <ProgressBar
                progress={progressByProject[project.id] ?? emptyProgress}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
