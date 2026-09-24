"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import AuthCard from "@/components/AuthCard";
import { Button, Field, Input, Spinner } from "@/components/ui";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { user, loading } = useAuth();
  const router = useRouter();

  // Already signed in (e.g. opened from the home screen): skip the form
  useEffect(() => {
    if (!loading && user) router.replace("/dashboard");
  }, [loading, user, router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");
    setSubmitting(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setMessage(error.message);
      setSubmitting(false);
    } else {
      router.push("/dashboard");
    }
  };

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Log in to plan your day."
      footer={{ text: "New here?", linkText: "Create an account", href: "/signup" }}
    >
      <form onSubmit={handleLogin} className="space-y-4">
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
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          )}
        </Field>

        <div className="-mt-2 text-right">
          <Link href="/forgot-password" className="text-sm text-accent hover:underline">
            Forgot password?
          </Link>
        </div>

        {message && (
          <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {message}
          </p>
        )}

        <Button type="submit" disabled={submitting} className="w-full">
          {submitting && <Spinner />}
          {submitting ? "Logging in..." : "Log in"}
        </Button>
      </form>
    </AuthCard>
  );
}
