"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { useAIBudget } from "@/lib/useAIBudget";
import { AI_COSTS } from "@/lib/ai/budget";
import { getDisplayName, saveDisplayName } from "@/lib/queries/profiles";
import { getProfile, saveProfile } from "@/lib/queries/persona";
import { clearLocalData } from "@/lib/persona/client";
import { disablePush, enablePush, pushSubscribed, pushSupported } from "@/lib/notifications";
import { useToast } from "@/components/Toast";
import { Button, Card, Field, Input, PageHeader, SectionTitle, Select, Skeleton } from "@/components/ui";
import { BellIcon, DownloadIcon, LogoutIcon, SparklesIcon, UserIcon } from "@/components/icons";
import { browserTimeZone } from "@/utils/date";
import { DEFAULT_NOTIFY, type NotifySettings } from "@/types/persona";

const COST_LABELS: Record<keyof typeof AI_COSTS, string> = {
  chat: "Assistant message",
  now: "“What now?” / free-time plan",
  suggest: "New ideas (made once a day)",
  steps: "Break a task into steps",
  review: "Weekly review",
  onboarding: "Telling your AI about you",
  summarize: "Keeping long chats short",
};

// Everything the user owns, for "Export my data"
const EXPORT_TABLES = [
  "profiles",
  "tasks",
  "task_series",
  "task_events",
  "goals",
  "projects",
  "assessments",
  "weekly_reviews",
  "conversations",
  "messages",
  "daily_suggestions",
  "ai_calls",
  "ai_usage",
] as const;

export default function SettingsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const budget = useAIBudget();

  const [name, setName] = useState("");
  const [nameLoaded, setNameLoaded] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [timezone, setTimezone] = useState("");
  const [notify, setNotify] = useState<NotifySettings>(DEFAULT_NOTIFY);
  const [pushOn, setPushOn] = useState(false);
  const [savingNotify, setSavingNotify] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [deleting, setDeleting] = useState(false);

  const zones = useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone");
    } catch {
      return [browserTimeZone()];
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    getDisplayName(user.id).then((displayName) => {
      setName(displayName ?? "");
      setNameLoaded(true);
    });
    getProfile(user.id)
      .then((p) => {
        setTimezone(p.timezone);
        setNotify(p.notify);
      })
      .catch(() => {});
    pushSubscribed().then(setPushOn);
  }, [user]);

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSavingName(true);
    const ok = await saveDisplayName(user.id, name);
    setSavingName(false);
    toast(ok ? "Name saved" : "Couldn't save your name. Try again.", { tone: ok ? "default" : "error" });
  };

  const saveTimezone = async (zone: string) => {
    if (!user) return;
    setTimezone(zone);
    const ok = await saveProfile(user.id, { timezone: zone });
    toast(ok ? "Timezone saved" : "Couldn't save. Try again.", { tone: ok ? "default" : "error" });
  };

  const saveNotify = async (next: NotifySettings) => {
    if (!user) return;
    setNotify(next);
    setSavingNotify(true);
    const ok = await saveProfile(user.id, { notify: next });
    setSavingNotify(false);
    if (!ok) toast("Couldn't save. Try again.", { tone: "error" });
  };

  const toggleNotifications = async () => {
    if (!user) return;
    if (notify.enabled) {
      await disablePush();
      setPushOn(false);
      await saveNotify({ ...notify, enabled: false });
      toast("Notifications off");
      return;
    }
    const problem = pushSupported() ? await enablePush(user.id) : null;
    if (problem) {
      toast(problem, { tone: "error" });
      if (!pushSupported()) {
        // No push here: in-app reminders still work while LifeOS is open
        if ("Notification" in window && (await Notification.requestPermission()) === "granted") {
          await saveNotify({ ...notify, enabled: true });
        }
      }
      return;
    }
    setPushOn(true);
    await saveNotify({ ...notify, enabled: true });
    toast("Notifications on 🔔");
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.email) return;
    if (password.length < 8) return toast("Use at least 8 characters.", { tone: "error" });
    setSavingPassword(true);
    // Confirm it's really you before changing it
    const check = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword });
    if (check.error) {
      setSavingPassword(false);
      return toast("Your current password is wrong.", { tone: "error" });
    }
    const { error } = await supabase.auth.updateUser({ password });
    setSavingPassword(false);
    if (error) {
      toast(error.message, { tone: "error" });
    } else {
      setPassword("");
      setCurrentPassword("");
      toast("Password changed");
    }
  };

  const exportData = async () => {
    setExporting(true);
    const result: Record<string, unknown> = { exported_at: new Date().toISOString(), email: user?.email };
    for (const table of EXPORT_TABLES) {
      const { data, error } = await supabase.from(table).select("*").limit(10000);
      result[table] = error ? { error: error.message } : data;
    }
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lifeos-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setExporting(false);
  };

  const deleteAccount = async () => {
    setDeleting(true);
    await disablePush().catch(() => {});
    const { error } = await supabase.rpc("delete_my_account");
    if (error) {
      setDeleting(false);
      console.error("Deleting account failed:", error.message);
      return toast("Couldn't delete your account. Try again or contact support.", { tone: "error" });
    }
    clearLocalData();
    await supabase.auth.signOut();
    router.push("/login");
  };

  const handleLogout = async () => {
    // This device shouldn't get this account's notifications after logging out
    await disablePush().catch(() => {});
    clearLocalData();
    await supabase.auth.signOut();
    router.push("/login");
  };

  const toggle = (key: "weekly_review" | "deadlines") => saveNotify({ ...notify, [key]: !notify[key] });

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" subtitle={user?.email} />

      <Link
        href="/profile"
        className="flex items-center gap-3 rounded-2xl bg-surface p-4 shadow-card transition hover:ring-2 hover:ring-accent/20"
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-grad-from to-grad-to text-white">
          <UserIcon className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-ink">My AI Persona</span>
          <span className="block text-sm text-muted">Who you are, what you&apos;re doing, what you want, and how your AI behaves</span>
        </span>
        <span className="text-muted">›</span>
      </Link>

      <Card>
        <SectionTitle>Your name</SectionTitle>
        {!nameLoaded ? (
          <Skeleton className="h-20" />
        ) : (
          <form onSubmit={handleSaveName} className="space-y-3">
            <Field label="What should LifeOS call you?">
              {(id) => (
                <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Nour" maxLength={50} />
              )}
            </Field>
            <div className="flex justify-end">
              <Button type="submit" disabled={savingName}>
                {savingName ? "Saving..." : "Save name"}
              </Button>
            </div>
          </form>
        )}
      </Card>

      <Card>
        <SectionTitle>AI usage</SectionTitle>
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <SparklesIcon />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-ink">
              {budget ? `${budget.limit - budget.remaining} of ${budget.limit} AI points used today` : "…"}
            </p>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-gradient-to-r from-grad-from to-grad-to"
                style={{ width: budget ? `${((budget.limit - budget.remaining) / Math.max(budget.limit, 1)) * 100}%` : "0%" }}
              />
            </div>
          </div>
        </div>
        <ul className="mt-4 grid gap-1 text-sm sm:grid-cols-2">
          {(Object.keys(AI_COSTS) as (keyof typeof AI_COSTS)[])
            .filter((k) => k !== "summarize")
            .map((k) => (
              <li key={k} className="flex justify-between gap-2 text-muted">
                <span>{COST_LABELS[k]}</span>
                <span className="font-medium text-ink">{AI_COSTS[k] ? `${AI_COSTS[k]} pt` : "free"}</span>
              </li>
            ))}
        </ul>
        <p className="mt-3 text-xs text-muted">
          Always free: simple questions (“what&apos;s on today?”), applying plans, reminders, the morning brief, the evening
          check-in, catching up on missed tasks, exam study plans and editing your persona. Points reset at midnight in your
          timezone, and a failed AI answer gives its points back.
        </p>
      </Card>

      <Card>
        <SectionTitle>Time zone</SectionTitle>
        <Field label="Your days, reminders and AI points follow this time zone">
          {(id) => (
            <Select id={id} value={timezone} onChange={(e) => saveTimezone(e.target.value)}>
              {!zones.includes(timezone) && timezone && <option value={timezone}>{timezone}</option>}
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, " ")}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <p className="mt-2 text-xs text-muted">Detected from this device: {browserTimeZone()}</p>
      </Card>

      <Card>
        <SectionTitle>Notifications</SectionTitle>
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <BellIcon />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-ink">{notify.enabled ? "On" : "Off"}</p>
            <p className="text-sm text-muted">
              {notify.enabled
                ? pushOn
                  ? "This device gets reminders even when LifeOS is closed."
                  : "Reminders show while LifeOS is open on this device."
                : "Task reminders, a morning brief, an evening check-in, deadlines and your weekly review."}
            </p>
          </div>
          <Button variant={notify.enabled ? "secondary" : "primary"} size="sm" onClick={toggleNotifications} disabled={savingNotify}>
            {notify.enabled ? "Turn off" : "Turn on"}
          </Button>
        </div>
        {notify.enabled && (
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Field label="Remind me before tasks">
              {(id) => (
                <Select
                  id={id}
                  value={notify.reminder_minutes}
                  onChange={(e) => saveNotify({ ...notify, reminder_minutes: Number(e.target.value) })}
                >
                  {[0, 5, 10, 15, 30, 60].map((m) => (
                    <option key={m} value={m}>
                      {m === 0 ? "At the start" : `${m} min before`}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Morning brief">
              {(id) => (
                <Input id={id} type="time" value={notify.morning} onChange={(e) => e.target.value && saveNotify({ ...notify, morning: e.target.value })} />
              )}
            </Field>
            <Field label="Evening check-in">
              {(id) => (
                <Input id={id} type="time" value={notify.evening} onChange={(e) => e.target.value && saveNotify({ ...notify, evening: e.target.value })} />
              )}
            </Field>
            <Field label="Quiet from – to">
              {() => (
                <div className="flex gap-1.5">
                  <Input type="time" aria-label="Quiet hours start" value={notify.quiet_start} onChange={(e) => e.target.value && saveNotify({ ...notify, quiet_start: e.target.value })} />
                  <Input type="time" aria-label="Quiet hours end" value={notify.quiet_end} onChange={(e) => e.target.value && saveNotify({ ...notify, quiet_end: e.target.value })} />
                </div>
              )}
            </Field>
            <label className="col-span-2 flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={notify.deadlines} onChange={() => toggle("deadlines")} className="h-4 w-4 accent-[var(--accent)]" />
              Deadline countdowns (14, 7, 3 and 1 days before)
            </label>
            <label className="col-span-2 flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={notify.weekly_review} onChange={() => toggle("weekly_review")} className="h-4 w-4 accent-[var(--accent)]" />
              Weekly review on Sunday evening
            </label>
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle>Change password</SectionTitle>
        <form onSubmit={handleChangePassword} className="space-y-3">
          <Field label="Current password">
            {(id) => (
              <Input
                id={id}
                type="password"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            )}
          </Field>
          <Field label="New password">
            {(id) => (
              <Input
                id={id}
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
              />
            )}
          </Field>
          <div className="flex justify-end">
            <Button type="submit" variant="secondary" disabled={savingPassword}>
              {savingPassword ? "Saving..." : "Change password"}
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <SectionTitle>Your data</SectionTitle>
        <p className="text-sm text-muted">
          Your tasks and persona are private to you. To plan for you, the relevant parts are sent to our AI provider
          (OpenAI) with each AI request.{" "}
          <Link href="/privacy" className="text-accent hover:underline">
            Privacy details
          </Link>
        </p>
        <Button variant="secondary" className="mt-3 w-full" onClick={exportData} disabled={exporting}>
          <DownloadIcon className="h-4 w-4" />
          {exporting ? "Preparing…" : "Export my data (JSON)"}
        </Button>
        <details className="mt-3 rounded-xl border border-danger/30 p-3">
          <summary className="cursor-pointer text-sm font-medium text-danger">Delete my account</summary>
          <p className="mt-2 text-sm text-muted">
            This permanently deletes your account, tasks, routines, goals, persona, chats and history. It can&apos;t be undone.
            Type <strong className="text-ink">DELETE</strong> to confirm.
          </p>
          <div className="mt-2 flex gap-2">
            <Input value={deleteText} onChange={(e) => setDeleteText(e.target.value)} aria-label="Type DELETE to confirm" />
            <Button variant="danger" className="border border-danger/30" disabled={deleteText !== "DELETE" || deleting} onClick={deleteAccount}>
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </details>
      </Card>

      <Button variant="danger" className="w-full border border-danger/30" onClick={handleLogout}>
        <LogoutIcon className="h-4 w-4" />
        Log out
      </Button>
    </div>
  );
}
