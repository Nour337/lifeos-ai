"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { Spinner } from "@/components/ui";
import {
  ChecklistIcon,
  FolderIcon,
  LogoMark,
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
  const pathname = usePathname();

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

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/80 pt-[env(safe-area-inset-top)] backdrop-blur-lg">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-2 px-4">
          <Link href="/dashboard" className="mr-4 flex items-center gap-2">
            <LogoMark className="h-7 w-7" />
            <span className="font-semibold tracking-tight text-ink">LifeOS</span>
          </Link>

          {/* Desktop navigation; phones use the bottom tab bar */}
          <nav className="hidden items-center gap-1 sm:flex">
            {navLinks.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  isActive(href)
                    ? "bg-surface-2 text-ink"
                    : "text-muted hover:text-ink"
                }`}
              >
                {label}
              </Link>
            ))}
          </nav>

          <Link
            href="/settings"
            className={`ml-auto flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition hover:bg-surface-2 hover:text-ink ${
              isActive("/settings") ? "bg-surface-2 text-ink" : "text-muted"
            }`}
            aria-label="Settings"
          >
            <SettingsIcon className="h-[18px] w-[18px]" />
            <span className="hidden sm:inline">Settings</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-28 pt-6 sm:pb-12 sm:pt-8">
        {children}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg sm:hidden">
        <div className="grid grid-cols-4">
          {navLinks.map(({ href, label, Icon }) => (
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
          ))}
        </div>
      </nav>
    </div>
  );
}
