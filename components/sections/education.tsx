"use client";

import Link from "next/link";
import { Highlightable, Section } from "./section";
import { LogoPlate } from "@/components/ui/logo-plate";
import { entityPath, itemId, type Certification, type Education as EducationItem } from "@/lib/content/types";

export function Education({
  education,
  certifications,
}: {
  education: EducationItem[];
  certifications: Certification[];
}) {
  if (!education.length && !certifications.length) return null;

  return (
    <Section id="education" eyebrow="06 — Education" title="Where I learned it">
      <div className="grid gap-10 md:grid-cols-2">
        {education.length > 0 && (
          <div className="space-y-6">
            <h3 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Education</h3>
            {education.map((e) => (
              <Highlightable key={e.slug} itemId={itemId("education", e.slug)}>
                <article className="flex items-start gap-3">
                  <LogoPlate src={e.logoUrl} name={e.institution} />
                  <div className="min-w-0">
                    {/*
                      A link only where there is a page. Education is the one
                      type where a published row may have none — see
                      educationHasPage — and a link to a 404 is worse than a
                      heading that stays a heading.
                    */}
                    <h4 className="font-display text-xl leading-tight">
                      {e.body?.length ? (
                        <Link
                          href={entityPath("education", e.slug)}
                          className="transition-colors hover:text-accent"
                        >
                          {e.degree}
                          <span className="ml-1.5 font-mono text-xs text-muted" aria-hidden="true">
                            →
                          </span>
                        </Link>
                      ) : (
                        e.degree
                      )}
                    </h4>
                    {e.field && <p className="text-muted">{e.field}</p>}
                    <p className="mt-1 text-accent">{e.institution}</p>
                    {(e.startYear || e.endYear) && (
                      <p className="mt-1 font-mono text-xs text-muted">
                        {e.startYear} — {e.endYear ?? "Present"}
                      </p>
                    )}
                    {e.note && <p className="mt-2 text-sm text-muted">{e.note}</p>}
                  </div>
                </article>
              </Highlightable>
            ))}
          </div>
        )}

        {certifications.length > 0 && (
          <div className="space-y-6">
            <h3 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">
              Certifications
            </h3>
            {certifications.map((c) => (
              <Highlightable key={c.slug} itemId={itemId("certifications", c.slug)}>
                <article className="flex items-start gap-3">
                  <LogoPlate src={c.logoUrl} name={c.issuer} />
                  <div className="min-w-0">
                    <h4 className="font-display text-xl leading-tight">
                      <Link
                        href={entityPath("certifications", c.slug)}
                        className="transition-colors hover:text-accent"
                      >
                        {c.name}
                        <span className="ml-1.5 font-mono text-xs text-muted" aria-hidden="true">
                          →
                        </span>
                      </Link>
                    </h4>
                    <p className="mt-1 text-accent">{c.issuer}</p>
                    {c.issueDate && (
                      <p className="mt-1 font-mono text-xs text-muted">{c.issueDate}</p>
                    )}
                    {c.credentialUrl && (
                      <a
                        href={c.credentialUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-block font-mono text-xs uppercase tracking-widest text-accent hover:underline"
                      >
                        Verify →
                      </a>
                    )}
                  </div>
                </article>
              </Highlightable>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}
