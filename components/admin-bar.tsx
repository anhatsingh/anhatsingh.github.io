"use client";

import Link from "next/link";
import { signOut } from "@/app/admin/actions";

/*
  A slim bar across the top of the public site when Anhat is signed in.

  It exists because the site behaves differently for him: the chatbot drops its
  scope rules and answers as an advisor rather than as a portfolio guide. A mode
  change that invisible needs saying out loud — otherwise the one person who
  can't tell whether he's seeing the visitor experience is the person who most
  needs to.

  It is rendered from a session verified on the server, never from anything in
  the URL. A "?code=" in the address bar means someone clicked a magic link; it
  does not mean the link was theirs, that it was still valid, or that the
  address is on the allow-list. Treating its presence as proof would let anyone
  unlock this by typing it.
*/
export function AdminBar({ email }: { email: string }) {
  return (
    <div className="relative z-40 border-b border-accent/30 bg-accent/10">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-6 py-1.5">
        <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-accent">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
          Signed in
          <span className="hidden text-muted normal-case tracking-normal sm:inline">{email}</span>
        </span>

        <span className="flex items-center gap-4">
          {/* Says what actually changed, rather than leaving him to notice. */}
          <span className="hidden font-mono text-[10px] uppercase tracking-widest text-muted md:inline">
            chat unrestricted
          </span>
          <Link
            href="/admin"
            className="font-mono text-[10px] uppercase tracking-widest text-accent hover:underline"
          >
            Dashboard →
          </Link>
          <form action={signOut}>
            <button className="font-mono text-[10px] uppercase tracking-widest text-muted transition-colors hover:text-danger">
              Sign out
            </button>
          </form>
        </span>
      </div>
    </div>
  );
}
