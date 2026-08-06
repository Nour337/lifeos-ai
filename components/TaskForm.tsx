"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import type { Task, TaskPriority } from "@/types/task";

type TaskFormProps = {
  onTaskSaved: () => void;
  editingTask?: Task | null;
  onCancelEdit?: () => void;
};

export default function TaskForm({
  onTaskSaved,
  editingTask,
  onCancelEdit,
}: TaskFormProps) {
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Pre-fill the form when editingTask is passed in
  useEffect(() => {
    if (editingTask) {
      setTitle(editingTask.title);
      setDescription(editingTask.description ?? "");
      setPriority(editingTask.priority);
      setDueDate(editingTask.due_date ?? "");
    } else {
      setTitle("");
      setDescription("");
      setPriority("medium");
      setDueDate("");
    }
  }, [editingTask]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setSaving(true);
    setError("");

    let result;
    if (editingTask) {
      // Update existing task
      result = await supabase
        .from("tasks")
        .update({
          title,
          description: description || null,
          priority,
          due_date: dueDate || null,
        })
        .eq("id", editingTask.id);
    } else {
      // Insert new task
      result = await supabase.from("tasks").insert({
        user_id: user.id,
        title,
        description: description || null,
        priority,
        due_date: dueDate || null,
        status: "todo",
      });
    }

    setSaving(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    setTitle("");
    setDescription("");
    setPriority("medium");
    setDueDate("");
    onTaskSaved();
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-2xl space-y-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <input
        type="text"
        placeholder="Task title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
        className="w-full rounded-md border border-zinc-300 px-3 py-2 text-black dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
      />
      <textarea
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="w-full rounded-md border border-zinc-300 px-3 py-2 text-black dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
      />
      <div className="flex gap-3">
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as TaskPriority)}
          className="rounded-md border border-zinc-300 px-3 py-2 text-black dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="rounded-md border border-zinc-300 px-3 py-2 text-black dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
        />
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-black px-4 py-2 text-white transition hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
        >
          {saving ? "Saving..." : editingTask ? "Update Task" : "Add Task"}
        </button>
        {editingTask && onCancelEdit && (
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