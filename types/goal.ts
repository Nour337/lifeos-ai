import type { Importance } from "@/types/persona";

export interface Goal {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  target_date: string | null;
  progress: number; // 0-100, used only when progress_manual
  progress_manual: boolean; // false = calculated from its tasks and milestones
  why: string | null;
  priority: Importance | null;
  weekly_hours: number | null;
  created_at: string;
}
