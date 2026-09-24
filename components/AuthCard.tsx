import Link from "next/link";
import { LogoMark } from "@/components/icons";

export default function AuthCard({
  title,
  subtitle,
  footer,
  children,
}: {
  title: string;
  subtitle: string;
  footer: { text: string; linkText: string; href: string };
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <LogoMark className="h-12 w-12" />
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-ink">
            {title}
          </h1>
          <p className="mt-1.5 text-muted">{subtitle}</p>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
          {children}
        </div>

        <p className="mt-6 text-center text-sm text-muted">
          {footer.text}{" "}
          <Link href={footer.href} className="font-medium text-accent hover:underline">
            {footer.linkText}
          </Link>
        </p>
      </div>
    </div>
  );
}
