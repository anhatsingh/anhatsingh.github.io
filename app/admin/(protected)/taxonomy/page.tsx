import { TaxonomyPanel } from "@/components/admin/taxonomy-panel";
import { loadTaxonomyInputs } from "@/app/admin/actions";
import { unabsorbed } from "@/lib/content/vocabulary";

/*
  Grouping the Skills section.

  A page of its own rather than a control on the skills table, because it is
  not a row edit: it renames headings, moves fifty badges and can retire a
  page. Named `taxonomy` and not `skills` on purpose — a literal `skills`
  segment would shadow the [section] route and take the ordinary skills editor
  down with it.
*/

export const dynamic = "force-dynamic";

export default async function TaxonomyPage() {
  const inputs = await loadTaxonomyInputs();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl">Skill headings</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          The Skills section groups badges by their category, and the categories were set once by hand
          after the LinkedIn import. This proposes a fresh set from everything the site knows — the
          skills themselves plus the tech listed on every job and project — and applies whatever you
          approve.
        </p>
      </div>

      {inputs.ok ? (
        <TaxonomyPanel
          vocabularySize={inputs.vocabulary.length}
          unabsorbedCount={unabsorbed(inputs.vocabulary).length}
        />
      ) : (
        <p className="rounded-[var(--radius)] border border-hairline bg-surface p-4 text-sm text-muted">
          {inputs.error}
        </p>
      )}
    </div>
  );
}
