"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useAuth } from "@/lib/AuthContext";
import { getProjects, deleteProject } from "@/lib/queries/projects";
import { getTasks } from "@/lib/queries/tasks";
import { getProjectProgress, type Progress } from "@/lib/progress";
import ProjectList from "@/components/ProjectList";
import ProjectForm from "@/components/ProjectForm";
import type { Project } from "@/types/project";
import type { Task } from "@/types/task";

export default function ProjectsPage() {
  const { user, loading } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [editingProject, setEditingProject] = useState<Project | null>(null);

  const refreshProjects = useCallback(() => {
    getProjects().then(setProjects);
    getTasks().then(setTasks);
  }, []);

  const progressByProject = useMemo(() => {
    const result: Record<string, Progress> = {};
    for (const project of projects) {
      result[project.id] = getProjectProgress(project.id, tasks);
    }
    return result;
  }, [projects, tasks]);

  useEffect(() => {
    if (user) refreshProjects();
  }, [user, refreshProjects]);

  const handleProjectSaved = () => {
    setEditingProject(null);
    refreshProjects();
  };

  const handleDeleteProject = async (id: string) => {
    const success = await deleteProject(id);
    if (success) {
      if (editingProject?.id === id) setEditingProject(null);
      refreshProjects();
    }
  };

  if (loading) return <p className="p-8">Loading...</p>;

  return (
    <div className="flex flex-col items-center gap-6 p-4 sm:p-8">
      <h1 className="w-full max-w-2xl text-2xl font-semibold text-black dark:text-white">
        Projects
      </h1>

      <ProjectForm
        key={editingProject?.id ?? "new"}
        onProjectSaved={handleProjectSaved}
        editingProject={editingProject}
        onCancelEdit={() => setEditingProject(null)}
      />

      <ProjectList
        projects={projects}
        progressByProject={progressByProject}
        onEditProject={setEditingProject}
        onDeleteProject={handleDeleteProject}
      />
    </div>
  );
}