"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { getGoals } from "@/lib/queries/goals";
import type { Project } from "@/types/project";
import type { Goal } from "@/types/goal";

type ProjectFormProps = {
  onProjectSaved: () => void;
  editingProject?: Project | null;
  onCancelEdit?: () => void;
};

export default function ProjectForm({
  onProjectSaved,
  editingProject,
  onCancelEdit,
}: ProjectFormProps) {
  const { user } = useAuth();
  // Initial values come from editingProject; the parent remounts the form via `key`
  const [name, setName] = useState(editingProject?.name ?? "");
  const [description, setDescription] = useState(
    editingProject?.description ?? ""
  );
  const [deadline, setDeadline] = useState(editingProject?.deadline ?? "");
  const [goalId, setGoalId] = useState(editingProject?.goal_id ?? "");
  const [goals, setGoals] = useState<Goal[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (user) {
      getGoals().then(setGoals);
    }
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setSaving(true);
    setError("");

    const projectData = {
      name,
      description: description || null,
      deadline: deadline || null,
      goal_id: goalId || null,
    };

    let result;
    if (editingProject) {
      result = await supabase
        .from("projects")
        .update(projectData)
        .eq("id", editingProject.id);
    } else {
      result = await supabase.from("projects").insert({
        user_id: user.id,
        ...projectData,
      });
    }

    setSaving(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    setName("");
    setDescription("");
    setDeadline("");
    setGoalId("");
    onProjectSaved();
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-2xl space-y-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <input
        type="text"
        placeholder="Project name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        className="w-full rounded-md border border-zinc-300 px-3 py-2 text-black dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
      />
      <textarea
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="w-full rounded-md border border-zinc-300 px-3 py-2 text-black dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
      />
      <div className="flex flex-wrap gap-3">
        <input
          type="date"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
          className="rounded-md border border-zinc-300 px-3 py-2 text-black dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
        />
        <select
          value={goalId}
          onChange={(e) => setGoalId(e.target.value)}
          className="rounded-md border border-zinc-300 px-3 py-2 text-black dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
        >
          <option value="">No goal</option>
          {goals.map((goal) => (
            <option key={goal.id} value={goal.id}>
              {goal.name}
            </option>
          ))}
        </select>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-black px-4 py-2 text-white transition hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
        >
          {saving ? "Saving..." : editingProject ? "Update Project" : "Add Project"}
        </button>
        {editingProject && onCancelEdit && (
          <button
            type="button"
            onClick={onCancelEdit}
            className="rounded-md border border-zinc-300 px-4 py-2 text-black dark:border-zinc-700 dark:text-white"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}