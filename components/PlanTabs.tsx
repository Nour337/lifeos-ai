import Link from "next/link";

// Goals and Projects share one tab in the navigation
export default function PlanTabs({ active }: { active: "goals" | "projects" }) {
  const tabs = [
    { key: "goals", href: "/goals", label: "Goals" },
    { key: "projects", href: "/projects", label: "Projects" },
  ] as const;
  return (
    <div className="inline-flex rounded-xl bg-surface p-1 shadow-card">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={active === tab.key ? "page" : undefined}
          className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${
            active === tab.key ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
