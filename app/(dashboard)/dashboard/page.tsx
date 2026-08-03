"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [taskCount, setTaskCount] = useState<number | null>(null);

  useEffect(() => {
    if (user) {
      supabase
        .from("tasks")
        .select("*")
        .then(({ data, error }) => {
          if (error) console.error(error);
          setTaskCount(data?.length ?? 0);
        });
    }
  }, [user]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  if (loading) return <p className="p-8">Loading...</p>;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-50 dark:bg-black">
      <h1 className="text-2xl font-semibold text-black dark:text-white">
        Welcome, {user?.email ?? "Guest"}
      </h1>
      <p className="text-lg text-zinc-600 dark:text-zinc-400">
        You have {taskCount === null ? "..." : taskCount} tasks visible to you.
      </p>
      <button
        onClick={handleLogout}
        className="rounded-md bg-red-600 px-4 py-2 text-white transition hover:bg-red-700"
      >
        Log Out
      </button>
    </div>
  );
}