export interface Goal {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  target_date: string | null;
  progress: number;
  created_at: string;
}