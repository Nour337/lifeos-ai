export interface Project {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  deadline: string | null;
  goal_id: string | null;
  created_at: string;
}