"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { getGoals } from "@/lib/queries/goals";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import type { Project } from "@/types/project";
import type { Goal } from "@/types/goal";

type ProjectFormProps = {
  onProjectSaved: () => void;
  editingProject?: Project | null;
  onCancel?: () => void;
};

export default function ProjectForm({
  onProjectSaved,
  editingProject,
  onCancel,
}: ProjectFormProps) {
  const { user } = useAuth();
  // Initial values come from editingProject; the form remounts per project
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
      name: name.trim(),
      description: description.trim() || null,
      deadline: deadline || null,
      goal_id: goalId || null,
    };

    const result = editingProject
      ? await supabase
          .from("projects")
          .update(projectData)
          .eq("id", editingProject.id)
      : await supabase
          .from("projects")
          .insert({ user_id: user.id, ...projectData });

    setSaving(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    onProjectSaved();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="Name">
        {(id) => (
          <Input
            id={id}
            placeholder="e.g. Launch portfolio site"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus={!editingProject}
          />
        )}
      </Field>
      <Field label="Description">
        {(id) => (
          <Textarea
            id={id}
            placeholder="Optional"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Deadline">
          {(id) => (
            <Input
              id={id}
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          )}
        </Field>
        <Field label="Goal">
          {(id) => (
            <Select
              id={id}
              value={goalId}
              onChange={(e) => setGoalId(e.target.value)}
            >
              <option value="">None</option>
              {goals.map((goal) => (
                <option key={goal.id} value={goal.id}>
                  {goal.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {error && (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={saving || !name.trim()}>
          {saving ? "Saving..." : editingProject ? "Save changes" : "Create project"}
        </Button>
      </div>
    </form>
  );
}
