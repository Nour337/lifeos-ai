import { supabase } from "@/lib/supabaseClient";
import type { Project } from "@/types/project";

export async function getProjects(): Promise<Project[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching projects:", error.message);
    throw new Error("Couldn't load your projects.");
  }

  return data as Project[];
}

export async function deleteProject(id: string): Promise<boolean> {
  const { error } = await supabase.from("projects").delete().eq("id", id);

  if (error) {
    console.error("Error deleting project:", error.message);
    return false;
  }

  return true;
}

export async function getProjectById(id: string): Promise<Project | null> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  // No row = not found (null); a real error should surface as an error
  if (error) {
    console.error("Error fetching project:", error.message);
    throw new Error("Couldn't load this project.");
  }

  return data as Project;
}