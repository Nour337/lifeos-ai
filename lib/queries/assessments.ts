import { supabase } from "@/lib/supabaseClient";
import type { Assessment } from "@/types/project";

// Exams, quizzes and assignments of a course
export async function getAssessments(projectId?: string): Promise<Assessment[]> {
  let query = supabase.from("assessments").select("*").order("due_date");
  if (projectId) query = query.eq("project_id", projectId);
  const { data, error } = await query;
  if (error) {
    console.error("Error fetching assessments:", error.message);
    throw new Error("Couldn't load exams and assignments.");
  }
  return (data ?? []) as Assessment[];
}

export async function saveAssessment(
  userId: string,
  assessment: Omit<Assessment, "id" | "user_id" | "created_at"> & { id?: string }
): Promise<Assessment | null> {
  const { id, ...fields } = assessment;
  const { data, error } = id
    ? await supabase.from("assessments").update(fields).eq("id", id).select().single()
    : await supabase
        .from("assessments")
        .insert({ user_id: userId, ...fields })
        .select()
        .single();
  if (error) {
    console.error("Error saving assessment:", error.message);
    return null;
  }
  return data as Assessment;
}

export async function deleteAssessment(id: string): Promise<boolean> {
  const { error } = await supabase.from("assessments").delete().eq("id", id);
  if (error) console.error("Error deleting assessment:", error.message);
  return !error;
}
