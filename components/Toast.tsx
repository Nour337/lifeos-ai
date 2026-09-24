"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { CloseIcon } from "@/components/icons";

type Toast = {
  id: number;
  message: string;
  tone: "default" | "error";
  action?: { label: string; onClick: () => void };
};

type ShowToast = (
  message: string,
  options?: { tone?: Toast["tone"]; action?: Toast["action"] }
) => void;

const ToastContext = createContext<ShowToast>(() => {});

const DURATION_MS = 5000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback<ShowToast>(
    (message, options = {}) => {
      const id = nextId.current++;
      // Keep at most 3 on screen
      setToasts((prev) => [
        ...prev.slice(-2),
        { id, message, tone: options.tone ?? "default", action: options.action },
      ]);
      setTimeout(() => dismiss(id), DURATION_MS);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      {/* Sits above the phone tab bar and the add button */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-40 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === "error" ? "alert" : "status"}
            className={`animate-sheet-in pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-xl px-4 py-3 text-sm shadow-lg ${
              toast.tone === "error"
                ? "bg-danger text-white"
                : "bg-ink text-bg"
            }`}
          >
            <span className="flex-1">{toast.message}</span>
            {toast.action && (
              <button
                onClick={() => {
                  toast.action!.onClick();
                  dismiss(toast.id);
                }}
                className="shrink-0 rounded-md px-2 py-1 font-semibold underline-offset-2 hover:underline"
              >
                {toast.action.label}
              </button>
            )}
            <button
              onClick={() => dismiss(toast.id)}
              className="shrink-0 opacity-60 hover:opacity-100"
              aria-label="Dismiss"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
