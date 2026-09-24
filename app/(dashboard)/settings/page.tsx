"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { AI_DAILY_LIMIT } from "@/lib/ai/limits";
import {
  getAICreditsLeft,
  getDisplayName,
  saveDisplayName,
} from "@/lib/queries/profiles";
import { useToast } from "@/components/Toast";
import { Button, Card, Field, Input, PageHeader, SectionTitle, Skeleton } from "@/components/ui";
import { LogoutIcon, SparklesIcon } from "@/components/icons";

export default function SettingsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const toast = useToast();

  const [name, setName] = useState("");
  const [nameLoaded, setNameLoaded] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [creditsLeft, setCreditsLeft] = useState<number | null>(null);

  const [password, setPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    if (!user) return;
    getDisplayName(user.id).then((displayName) => {
      setName(displayName ?? "");
      setNameLoaded(true);
    });
    getAICreditsLeft(user.id).then(setCreditsLeft);
  }, [user]);

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSavingName(true);
    const ok = await saveDisplayName(user.id, name);
    setSavingName(false);
    toast(ok ? "Name saved" : "Couldn't save your name. Try again.", {
      tone: ok ? "default" : "error",
    });
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPassword(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSavingPassword(false);
    if (error) {
      toast(error.message, { tone: "error" });
    } else {
      setPassword("");
      toast("Password changed");
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" subtitle={user?.email} />

      <Card>
        <SectionTitle>Your name</SectionTitle>
        {!nameLoaded ? (
          <Skeleton className="h-20" />
        ) : (
          <form onSubmit={handleSaveName} className="space-y-3">
            <Field label="What should LifeOS call you?">
              {(id) => (
                <Input
                  id={id}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Nour"
                  maxLength={50}
                />
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
        <SectionTitle>AI assistant</SectionTitle>
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <SparklesIcon />
          </span>
          <div>
            <p className="font-medium text-ink">
              {creditsLeft === null ? "…" : creditsLeft} of {AI_DAILY_LIMIT} questions
              left today
            </p>
            <p className="text-sm text-muted">
              The limit keeps AI costs under control. It resets every day.
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle>Change password</SectionTitle>
        <form onSubmit={handleChangePassword} className="space-y-3">
          <Field label="New password">
            {(id) => (
              <Input
                id={id}
                type="password"
                autoComplete="new-password"
                minLength={6}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
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

      <Button variant="danger" className="w-full border border-danger/30" onClick={handleLogout}>
        <LogoutIcon className="h-4 w-4" />
        Log out
      </Button>
    </div>
  );
}
