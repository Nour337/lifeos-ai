"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import type { Goal } from "@/types/goal";

type GoalFormProps = {
  onGoalSaved: () => void;
  editingGoal?: Goal | null;
  onCancelEdit?: () => void;
};

export default function GoalForm({
  onGoalSaved,
  editingGoal,
  onCancelEdit,
}: GoalFormProps) {
  const { user } = useAuth();
  // Initial values come from editingGoal; the parent remounts the form via `key`
  const [name, setName] = useState(editingGoal?.name ?? "");
  const [description, setDescription] = useState(
    editingGoal?.description ?? ""
  );
  const [targetDate, setTargetDate] = useState(editingGoal?.target_date ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setSaving(true);
    setError("");

    let result;
    if (editingGoal) {
      result = await supabase
        .from("goals")
        .update({
          name,
          description: description || null,
          target_date: targetDate || null,
        })
        .eq("id", editingGoal.id);
    } else {
      result = await supabase.from("goals").insert({
        user_id: user.id,
        name,
        description: description || null,
        target_date: targetDate || null,
        progress: 0,
      });
    }

    setSaving(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    setName("");
    setDescription("");
    setTargetDate("");
    onGoalSaved();
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-2xl space-y-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <input
        type="text"
        placeholder="Goal name"
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
      <input
        type="date"
        value={targetDate}
        onChange={(e) => setTargetDate(e.target.value)}
        className="rounded-md border border-zinc-300 px-3 py-2 text-black dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
      />
      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-black px-4 py-2 text-white transition hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
        >
          {saving ? "Saving..." : editingGoal ? "Update Goal" : "Add Goal"}
        </button>
        {editingGoal && onCancelEdit && (
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