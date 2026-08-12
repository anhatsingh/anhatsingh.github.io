import { SECTION_LABELS, type SectionId } from "@/lib/content/types";

/*
  What ⌘K can jump to.

  This lives apart from the palette component because the layout builds the list
  on the server and hands it down as a prop. A "use client" module marks every
  export as a client reference, so importing this from there made the layout
  call across the boundary — which compiles cleanly and only fails when a page
  actually renders. That is why it sits in a plain module: the split is what
  keeps the boundary honest.
*/

export interface PaletteEntry {
  /** What to show. */
  label: string;
  /** Section, project, post — the kind, for grouping and for scanning. */
  kind: string;
  /** Where it goes. A section id scrolls; a path navigates. */
  section?: SectionId;
  href?: string;
}

/** Sections plus every addressable entry, as one flat list. */
export function buildPaletteEntries(
  sections: SectionId[],
  items: Array<{ id: string; label: string; href: string; kind: string }>,
): PaletteEntry[] {
  return [
    ...sections.map((s) => ({ label: SECTION_LABELS[s], kind: "section", section: s })),
    ...items.map((i) => ({ label: i.label, kind: i.kind, href: i.href })),
  ];
}
