"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import AuthCard from "@/components/AuthCard";
import { Button, Field, Input, Spinner } from "@/components/ui";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    // The email link opens /reset-password, where a new password is chosen.
    // This URL must be allowed in Supabase: Auth > URL Configuration.
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    setSubmitting(false);
    if (error) {
      setError(error.message);
    } else {
      setSent(true);
    }
  };

  return (
    <AuthCard
      title="Forgot your password?"
      subtitle="We'll email you a link to choose a new one."
      footer={{ text: "Remembered it?", linkText: "Log in", href: "/login" }}
    >
      {sent ? (
        <div className="text-center">
          <p className="font-medium text-ink">Check your email ✉️</p>
          <p className="mt-2 text-sm text-muted">
            If <strong>{email}</strong> has an account, a reset link is on its
            way. It can take a minute; check spam too.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Email">
            {(id) => (
              <Input
                id={id}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
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
            {submitting ? "Sending..." : "Send reset link"}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
