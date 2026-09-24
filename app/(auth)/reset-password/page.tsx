"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { useToast } from "@/components/Toast";
import AuthCard from "@/components/AuthCard";
import { Button, Field, Input, Spinner } from "@/components/ui";

// Opened from the password-reset email. Supabase reads the token from the
// link and signs the user in, so here we only need to set the new password.
export default function ResetPasswordPage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setError(error.message);
      setSubmitting(false);
    } else {
      toast("Password updated. Welcome back!");
      router.push("/dashboard");
    }
  };

  const footer = { text: "Need a new link?", linkText: "Send another", href: "/forgot-password" };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (!session) {
    return (
      <AuthCard
        title="Link expired"
        subtitle="This reset link is invalid or was already used."
        footer={footer}
      >
        <p className="text-center text-sm text-muted">
          Request a new link and open it on this device.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password" subtitle={session.user.email ?? ""} footer={footer}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="New password">
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              minLength={6}
              required
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
            />
          )}
        </Field>

        {error && (
          <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <Button type="submit" disabled={submitting} className="w-full">
          {submitting && <Spinner />}
          {submitting ? "Saving..." : "Save new password"}
        </Button>
      </form>
    </AuthCard>
  );
}
