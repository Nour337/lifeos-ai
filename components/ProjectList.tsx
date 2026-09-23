import Link from "next/link";
import type { Project } from "@/types/project";
import type { Progress } from "@/lib/progress";
import ProgressBar from "@/components/ProgressBar";

export default function ProjectList({
  projects,
  progressByProject,
  onEditProject,
  onDeleteProject,
}: {
  projects: Project[];
  progressByProject: Record<string, Progress>;
  onEditProject: (project: Project) => void;
  onDeleteProject: (id: string) => void;
}) {
  if (projects.length === 0) {
    return (
      <p className="p-8 text-center text-zinc-500 dark:text-zinc-400">
        No projects yet. Add one to get started.
      </p>
    );
  }

  return (
    <ul className="w-full max-w-2xl space-y-3">
      {projects.map((project) => (
        <li
          key={project.id}
          className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
        >
          <Link href={`/projects/${project.id}`} className="flex-1">
            <p className="font-medium text-black hover:underline dark:text-white">
              {project.name}
            </p>
            {project.deadline && (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Deadline: {project.deadline}
              </p>
            )}
            <div className="mt-2 max-w-xs">
              <ProgressBar
                progress={
                  progressByProject[project.id] ?? {
                    done: 0,
                    total: 0,
                    percent: 0,
                  }
                }
              />
            </div>
          </Link>
          <div className="flex gap-2">
            <button
              onClick={() => onEditProject(project)}
              className="rounded-md px-2 py-1 text-sm text-zinc-500 transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              Edit
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Delete "${project.name}"?`)) {
                  onDeleteProject(project.id);
                }
              }}
              className="rounded-md px-2 py-1 text-sm text-red-500 transition hover:bg-red-50 dark:hover:bg-red-900/20"
            >
              Delete
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}