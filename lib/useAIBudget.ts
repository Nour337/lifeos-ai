"use client";

import { useEffect, useState } from "react";
import { BUDGET_EVENT } from "@/lib/persona/client";
import { getAIBudget } from "@/lib/queries/profiles";
import type { Budget } from "@/lib/ai/budget";

// Today's AI points, kept in sync with every AI request on the page
export function useAIBudget(): Budget | null {
  const [budget, setBudget] = useState<Budget | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => getAIBudget().then((b) => !cancelled && b && setBudget(b));
    load();
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<Budget | null>).detail;
      if (detail) setBudget(detail);
      else load();
    };
    window.addEventListener(BUDGET_EVENT, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(BUDGET_EVENT, onChange);
    };
  }, []);

  return budget;
}
