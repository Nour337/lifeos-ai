import type { Importance } from "@/types/persona";

export interface Goal {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  target_date: string | null;
  progress: number; // 0-100, the user's own estimate
  why: string | null;
  priority: Importance | null;
  weekly_hours: number | null;
  created_at: string;
}
