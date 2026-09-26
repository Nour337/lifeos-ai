"use client";

import { useCallback, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useTasksChanged } from "@/lib/QuickAdd";
import { notificationsAllowed, pushSubscribed } from "@/lib/notifications";
import { timeToMinutes, toLocalDateString } from "@/utils/date";
import type { NotifySettings } from "@/types/persona";

// While the app is open, remind before today's timed tasks, for devices
// without push (the server sends reminders to subscribed devices).
export default function LocalReminders({ notify }: { notify: NotifySettings | null }) {
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const schedule = useCallback(async () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (!notify?.enabled || !notificationsAllowed() || (await pushSubscribed())) return;

    const today = toLocalDateString();
    const { data } = await supabase
      .from("tasks")
      .select("id, title, due_time")
      .eq("due_date", today)
      .not("due_time", "is", null)
      .in("status", ["todo", "in_progress"])
      .is("parent_id", null);

    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    for (const task of data ?? []) {
      const at = timeToMinutes(task.due_time) - notify.reminder_minutes;
      const wait = (at - nowMinutes) * 60_000;
      if (wait < 0 || wait > 12 * 3_600_000) continue;
      timers.current.push(
        setTimeout(() => {
          try {
            new Notification(task.title, { body: `Starts at ${task.due_time.slice(0, 5)}`, tag: task.id });
          } catch {
            // notifications not available here
          }
        }, wait)
      );
    }
  }, [notify]);

  useEffect(() => {
    schedule();
    const refresh = setInterval(schedule, 30 * 60_000);
    return () => {
      clearInterval(refresh);
      timers.current.forEach(clearTimeout);
    };
  }, [schedule]);

  useTasksChanged(schedule);
  return null;
}
