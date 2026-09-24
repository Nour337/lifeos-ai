"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { QuickAddProvider, useQuickAdd } from "@/lib/QuickAdd";
import { Button, Spinner } from "@/components/ui";
import {
  ChecklistIcon,
  FolderIcon,
  PlusIcon,
  SettingsIcon,
  SunIcon,
  TargetIcon,
} from "@/components/icons";

const navLinks = [
  { href: "/dashboard", label: "Today", Icon: SunIcon },
  { href: "/tasks", label: "Tasks", Icon: ChecklistIcon },
  { href: "/projects", label: "Projects", Icon: FolderIcon },
  { href: "/goals", label: "Goals", Icon: TargetIcon },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  return (
    <QuickAddProvider>
      <AppShell>{children}</AppShell>
    </QuickAddProvider>
  );
}

function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const openQuickAdd = useQuickAdd();

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  const tab = ({ href, label, Icon }: (typeof navLinks)[number]) => (
    <Link
      key={href}
      href={href}
      className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition ${
        isActive(href) ? "text-accent" : "text-muted"
      }`}
    >
      <Icon className="h-6 w-6" />
      {label}
    </Link>
  );

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-accent-soft/60 via-bg to-bg bg-fixed">
      <header className="sticky top-0 z-20 bg-bg/75 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-2 px-4">
          <Link
            href="/dashboard"
            className="mr-4 bg-gradient-to-r from-grad-from to-grad-to bg-clip-text text-xl font-bold tracking-tight text-transparent"
          >
            LifeOS
          </Link>

          {/* Desktop navigation; phones use the bottom tab bar */}
          <nav className="hidden items-center gap-1 sm:flex">
            {navLinks.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={`rounded-xl px-3 py-1.5 text-sm font-medium transition ${
                  isActive(href)
                    ? "bg-surface text-accent shadow-card"
                    : "text-muted hover:text-ink"
                }`}
              >
                {label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              className="hidden sm:inline-flex"
              onClick={() => openQuickAdd()}
            >
              <PlusIcon className="h-4 w-4" />
              New task
            </Button>
            <Link
              href="/settings"
              className={`flex h-10 w-10 items-center justify-center rounded-full bg-surface shadow-card transition hover:text-ink ${
                isActive("/settings") ? "text-accent" : "text-muted"
              }`}
              aria-label="Settings"
            >
              <SettingsIcon className="h-5 w-5" />
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-32 pt-4 sm:pb-12 sm:pt-6">
        {children}
      </main>

      {/* Phone tab bar with the round "+" in the middle */}
      <nav className="fixed inset-x-3 bottom-3 z-30 mb-[env(safe-area-inset-bottom)] rounded-3xl bg-surface/95 shadow-[0_8px_30px_rgba(26,27,46,0.12)] backdrop-blur-xl sm:hidden">
        <div className="grid grid-cols-5 items-center">
          {navLinks.slice(0, 2).map(tab)}
          <div className="flex justify-center">
            <button
              onClick={() => openQuickAdd()}
              aria-label="Add task"
              className="-mt-8 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-grad-from to-grad-to text-white shadow-lg shadow-accent/40 ring-4 ring-bg transition active:scale-95"
            >
              <PlusIcon className="h-7 w-7" />
            </button>
          </div>
          {navLinks.slice(2).map(tab)}
        </div>
      </nav>
    </div>
  );
}
