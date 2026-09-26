import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy · LifeOS AI",
  description: "What LifeOS stores, what is sent to the AI, and how to export or delete your data.",
};

// Plain-language privacy notice. Linked from Settings and the sign-up page.
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 text-ink">
      <Link href="/dashboard" className="text-sm text-accent hover:underline">
        ← Back to LifeOS
      </Link>
      <h1 className="mt-4 text-3xl font-bold tracking-tight">Privacy</h1>
      <p className="mt-2 text-muted">The short version: your data is yours, only you can see it, and you can take it or delete it anytime.</p>

      <section className="mt-8 space-y-3">
        <h2 className="text-lg font-semibold">What we store</h2>
        <ul className="list-disc space-y-1.5 pl-5 text-muted">
          <li>Your account (email and password, managed by Supabase Auth).</li>
          <li>Your tasks, routines, goals, projects, courses and exams, and the history of what you completed or moved.</li>
          <li>
            Your AI persona: what you told the AI about yourself (roles, studies, work, schedule, busy hours, preferences,
            notes it remembers). You can see and edit all of it on the My AI Persona page.
          </li>
          <li>Your conversations with the assistant, and a short summary of long ones.</li>
          <li>How many AI points you used, and technical logs of AI requests (no message text).</li>
        </ul>
        <p className="text-muted">
          Every row is protected by database rules so that only your account can read or change it. Some things can be
          sensitive (for example religious routines, your employer, or your age range): only add what you are comfortable with.
        </p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-lg font-semibold">What is sent to the AI</h2>
        <p className="text-muted">
          When you use an AI feature, the parts of your persona and schedule needed for that request are sent to our AI
          provider, OpenAI, through its API. Your age range is never sent. Features that don&apos;t need AI (reminders, the
          morning brief, the evening check-in, catching up on missed tasks, exam study plans, simple questions) send nothing.
        </p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-lg font-semibold">Notifications</h2>
        <p className="text-muted">
          If you turn on notifications, your browser gives us a push address for this device. It is removed when you turn
          notifications off or log out.
        </p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-lg font-semibold">Your controls</h2>
        <ul className="list-disc space-y-1.5 pl-5 text-muted">
          <li>Edit or delete anything the AI knows on the My AI Persona page, or undo it right in the chat.</li>
          <li>Export everything as a JSON file in Settings → Your data.</li>
          <li>Delete your account in Settings → Your data. Everything is removed permanently.</li>
        </ul>
      </section>
    </main>
  );
}
