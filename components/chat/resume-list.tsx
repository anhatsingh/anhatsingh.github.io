"use client";

import { DownloadIcon } from "@/components/ui/icons";

/*
  Every published resume, shown only when the visitor explicitly asks to see
  them all.

  Labels and links, nothing else. The keywords behind each variant describe how
  matching works, and the job descriptions that produced them are private — so
  neither appears here. What a visitor gets is a plain list of documents.
*/
export function ResumeList({ resumes }: { resumes: Array<{ label: string; url: string }> }) {
  if (!resumes.length) return null;

  return (
    <div className="mt-2 rounded-[var(--radius)] border border-hairline bg-surface p-3">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted">
        {resumes.length} version{resumes.length === 1 ? "" : "s"}
      </p>

      <ul className="mt-2 space-y-1">
        {resumes.map((r) => (
          <li key={r.url}>
            <a
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center justify-between gap-3 rounded-[var(--radius)] px-2 py-1.5 transition-colors hover:bg-elevated"
            >
              <span className="min-w-0 truncate text-sm">{r.label}</span>
              <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-accent">
                <DownloadIcon className="h-3 w-3" />
                PDF
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
