"use client";

import { useEffect, useState } from "react";
import {
  addSubtasks,
  deleteSubtask,
  getSubtasks,
  setSubtaskDone,
} from "@/lib/queries/subtasks";
import { useToast } from "@/components/Toast";
import { CloseIcon, PlusIcon } from "@/components/icons";
import { TaskCheckbox } from "@/components/TaskList";
import type { Task } from "@/types/task";

type Props =
  // Editing a saved task: changes are written straight to the database
  | { parent: Task; pending?: never; onPendingChange?: never; onProgress: (percent: number, count: number) => void }
  // New task: subtasks are kept here and saved together with the task
  | { parent?: never; pending: string[]; onPendingChange: (titles: string[]) => void; onProgress?: never };

export default function SubtaskEditor(props: Props) {
  const toast = useToast();
  const [subtasks, setSubtasks] = useState<Task[]>([]);
  const [draft, setDraft] = useState("");
  const parent = props.parent;
  const onProgress = props.onProgress;

  function report(list: Task[]) {
    const done = list.filter((s) => s.status === "done").length;
    onProgress?.(list.length ? Math.round((done / list.length) * 100) : 0, list.length);
  }

  useEffect(() => {
    if (!parent) return;
    getSubtasks(parent.id)
      .then((list) => {
        setSubtasks(list);
        report(list);
      })
      .catch(() => toast("Couldn't load subtasks.", { tone: "error" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per parent
  }, [parent]);

  const reload = async () => {
    if (!parent) return;
    const fresh = await getSubtasks(parent.id).catch(() => subtasks);
    setSubtasks(fresh);
    report(fresh);
  };

  const add = async () => {
    const title = draft.trim();
    if (!title) return;
    setDraft("");
    if (!parent) {
      props.onPendingChange?.([...(props.pending ?? []), title]);
      return;
    }
    if (!(await addSubtasks(parent, [title]))) {
      toast("Couldn't add the subtask.", { tone: "error" });
    }
    reload();
  };

  const items: { key: string; title: string; done: boolean; task?: Task }[] = parent
    ? subtasks.map((s) => ({ key: s.id, title: s.title, done: s.status === "done", task: s }))
    : (props.pending ?? []).map((title, i) => ({ key: String(i), title, done: false }));

  const doneCount = items.filter((i) => i.done).length;

  return (
    <div>
      <p className="mb-1.5 flex justify-between text-sm font-medium text-ink">
        Subtasks
        {items.length > 0 && (
          <span className="font-normal text-muted">
            {doneCount}/{items.length} done
          </span>
        )}
      </p>
      {items.length > 0 && (
        <ul className="mb-2 space-y-1">
          {items.map((item, i) => (
            <li key={item.key} className="flex items-center gap-2.5 rounded-lg bg-surface-2 px-2.5 py-1.5">
              {item.task ? (
                <TaskCheckbox
                  done={item.done}
                  title={item.title}
                  onToggle={async () => {
                    if (!(await setSubtaskDone(item.task!, !item.done))) {
                      toast("Couldn't update the subtask.", { tone: "error" });
                    }
                    reload();
                  }}
                />
              ) : (
                <span className="h-6 w-6 shrink-0 rounded-full border-2 border-line" />
              )}
              <span className={`flex-1 text-sm ${item.done ? "text-muted line-through" : "text-ink"}`}>
                {item.title}
              </span>
              <button
                type="button"
                aria-label={`Remove "${item.title}"`}
                className="rounded p-1 text-muted hover:text-danger"
                onClick={async () => {
                  if (!item.task) {
                    props.onPendingChange?.((props.pending ?? []).filter((_, j) => j !== i));
                    return;
                  }
                  if (!(await deleteSubtask(item.task))) {
                    toast("Couldn't remove the subtask.", { tone: "error" });
                  }
                  reload();
                }}
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault(); // don't submit the whole task form
              add();
            }
          }}
          placeholder="Add a subtask"
          className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none"
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim()}
          aria-label="Add subtask"
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent disabled:opacity-50"
        >
          <PlusIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
