"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import TaskForm from "@/components/TaskForm";
import { Modal } from "@/components/ui";

// The "+" button can add a task from any screen. After a save we broadcast
// an event so whichever list is on screen reloads itself.
const TASKS_CHANGED = "lifeos:tasks-changed";

export function notifyTasksChanged() {
  window.dispatchEvent(new Event(TASKS_CHANGED));
}

export function useTasksChanged(callback: () => void) {
  useEffect(() => {
    window.addEventListener(TASKS_CHANGED, callback);
    return () => window.removeEventListener(TASKS_CHANGED, callback);
  }, [callback]);
}

type QuickAddOptions = { dueDate?: string };

const QuickAddContext = createContext<(options?: QuickAddOptions) => void>(
  () => {}
);

export function QuickAddProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = useState<QuickAddOptions | null>(null);
  const close = useCallback(() => setOptions(null), []);
  const open = useCallback((o: QuickAddOptions = {}) => setOptions(o), []);

  return (
    <QuickAddContext.Provider value={open}>
      {children}
      <Modal open={options !== null} title="New task" onClose={close}>
        {options && (
          <TaskForm
            defaultDueDate={options.dueDate}
            onTaskSaved={() => {
              close();
              notifyTasksChanged();
            }}
            onCancel={close}
          />
        )}
      </Modal>
    </QuickAddContext.Provider>
  );
}

export function useQuickAdd() {
  return useContext(QuickAddContext);
}
