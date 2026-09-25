"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import AuthCard from "@/components/AuthCard";
import { Button, Field, Input, Spinner } from "@/components/ui";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [checkEmail, setCheckEmail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    const { data, error } = await supabase.auth.signUp({ email, password });

    if (error) {
      setError(error.message);
      setSubmitting(false);
    } else if (data.session) {
      // Email confirmation is off: the user is already signed in
      router.push("/onboarding");
    } else {
      setCheckEmail(true);
      setSubmitting(false);
    }
  };

  return (
    <AuthCard
      title="Create your account"
      subtitle="Tasks, projects, goals — and an AI to plan your day."
      footer={{ text: "Already have an account?", linkText: "Log in", href: "/login" }}
    >
      {checkEmail ? (
        <div className="text-center">
          <p className="font-medium text-ink">Check your email ✉️</p>
          <p className="mt-2 text-sm text-muted">
            We sent a confirmation link to <strong>{email}</strong>. Open it, then
            log in.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSignup} className="space-y-4">
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
          <Field label="Password">
            {(id) => (
              <Input
                id={id}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
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
            {submitting ? "Creating account..." : "Create account"}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
