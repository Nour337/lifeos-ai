"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useAuth } from "@/lib/AuthContext";
import { getProjects, deleteProject } from "@/lib/queries/projects";
import { getTasks } from "@/lib/queries/tasks";
import { getGoals } from "@/lib/queries/goals";
import { getProjectProgress, type Progress } from "@/lib/progress";
import ProjectList from "@/components/ProjectList";
import ProjectForm from "@/components/ProjectForm";
import { useToast } from "@/components/Toast";
import PlanTabs from "@/components/PlanTabs";
import { Button, EmptyState, ErrorState, Modal, PageHeader, Skeleton } from "@/components/ui";
import { FolderIcon, PlusIcon } from "@/components/icons";
import type { Project } from "@/types/project";
import type { Task } from "@/types/task";

export default function ProjectsPage() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [goalNames, setGoalNames] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const toast = useToast();
  // null = closed, { project: null } = new, { project } = editing
  const [form, setForm] = useState<{ project: Project | null } | null>(null);

  const refreshProjects = useCallback(() => {
    Promise.all([getProjects(), getTasks(), getGoals()])
      .then(([projectData, taskData, goalData]) => {
        // Milestones are shown under their goal
        setProjects(projectData.filter((p) => p.kind !== "milestone"));
        setTasks(taskData);
        setGoalNames(Object.fromEntries(goalData.map((g) => [g.id, g.name])));
        setLoadError("");
      })
      .catch((e: Error) => setLoadError(e.message))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (user) refreshProjects();
  }, [user, refreshProjects]);

  const progressByProject = useMemo(() => {
    const result: Record<string, Progress> = {};
    for (const project of projects) {
      result[project.id] = getProjectProgress(project, tasks);
    }
    return result;
  }, [projects, tasks]);

  const closeForm = useCallback(() => setForm(null), []);

  const handleProjectSaved = () => {
    setForm(null);
    refreshProjects();
  };

  const handleDeleteProject = async (id: string) => {
    if (await deleteProject(id)) {
      // Tasks in the project are kept, just no longer linked to it
      toast("Project deleted. Its tasks were kept.");
    } else {
      toast("Couldn't delete the project. Try again.", { tone: "error" });
    }
    refreshProjects();
  };

  return (
    <div className="space-y-5">
      <PlanTabs active="projects" />
      <PageHeader
        title="Projects"
        subtitle="Bigger pieces of work, made of tasks."
        action={
          <Button onClick={() => setForm({ project: null })}>
            <PlusIcon className="h-4 w-4" />
            New project
          </Button>
        }
      />

      {!loaded ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={refreshProjects} />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={<FolderIcon />}
          title="No projects yet"
          text="Group related tasks into a project to track progress."
          action={
            <Button onClick={() => setForm({ project: null })}>
              <PlusIcon className="h-4 w-4" />
              Create a project
            </Button>
          }
        />
      ) : (
        <ProjectList
          projects={projects}
          progressByProject={progressByProject}
          goalNames={goalNames}
          onEditProject={(project) => setForm({ project })}
          onDeleteProject={handleDeleteProject}
        />
      )}

      <Modal
        open={form !== null}
        title={form?.project ? "Edit project" : "New project"}
        onClose={closeForm}
      >
        {form && (
          <ProjectForm
            editingProject={form.project}
            onProjectSaved={handleProjectSaved}
            onCancel={closeForm}
          />
        )}
      </Modal>
    </div>
  );
}
