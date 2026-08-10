import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/app/admin/actions";
import { ADMIN_TABLES } from "@/lib/admin/schema";
import { getAdminSession } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/server";

/*
  The guard for every admin screen.

  Note this is a *rendering* guard. It stops a non-admin seeing the UI, but the
  real enforcement is that every server action re-checks the session itself —
  actions are directly invocable and never assume this ran.
*/
export default async function ProtectedAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isSupabaseConfigured) {
    return (
      <main className="mx-auto max-w-lg px-6 py-24">
        <h1 className="font-display text-3xl">Admin isn&apos;t set up yet</h1>
        <p className="mt-3 text-muted">
          Create a Supabase project, run <code className="text-accent">lib/db/schema.sql</code>, then
          set <code className="text-accent">NEXT_PUBLIC_SUPABASE_URL</code>,{" "}
          <code className="text-accent">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>,{" "}
          <code className="text-accent">SUPABASE_SERVICE_ROLE_KEY</code> and{" "}
          <code className="text-accent">ADMIN_EMAILS</code>.
        </p>
        <Link href="/" className="mt-6 inline-block font-mono text-xs uppercase tracking-widest text-accent">
          ← back to site
        </Link>
      </main>
    );
  }

  const session = await getAdminSession();
  if (!session) redirect("/admin/login");

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-hairline pb-6">
        <div>
          <h1 className="font-display text-2xl">Admin</h1>
          <p className="font-mono text-xs text-muted">{session.email}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/" className="font-mono text-xs uppercase tracking-widest text-muted hover:text-accent">
            view site →
          </Link>
          <form action={signOut}>
            <button className="font-mono text-xs uppercase tracking-widest text-muted hover:text-danger">
              sign out
            </button>
          </form>
        </div>
      </header>

      <nav className="mt-6 flex flex-wrap gap-2 border-b border-hairline pb-6">
        {ADMIN_TABLES.map((t) => (
          <Link
            key={t.key}
            href={`/admin/${t.key}`}
            className="rounded-[var(--radius)] border border-hairline px-3 py-1.5 font-mono text-xs uppercase tracking-widest text-muted transition-colors hover:border-accent hover:text-accent"
          >
            {t.label}
          </Link>
        ))}
        <Link
          href="/admin/repos"
          className="rounded-[var(--radius)] border border-hairline px-3 py-1.5 font-mono text-xs uppercase tracking-widest text-muted transition-colors hover:border-accent hover:text-accent"
        >
          Repos
        </Link>
        <Link
          href="/admin/resume"
          className="rounded-[var(--radius)] border border-accent/40 px-3 py-1.5 font-mono text-xs uppercase tracking-widest text-accent"
        >
          Generate resume
        </Link>
        <Link
          href="/admin/import"
          className="rounded-[var(--radius)] border border-accent/40 px-3 py-1.5 font-mono text-xs uppercase tracking-widest text-accent"
        >
          LinkedIn import
        </Link>
      </nav>

      <div className="py-8">{children}</div>
    </div>
  );
}
