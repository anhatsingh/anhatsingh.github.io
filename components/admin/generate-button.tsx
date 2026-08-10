"use client";

import { useRef, useState } from "react";
import { requestShortSummary } from "@/app/admin/actions";
import type { Field } from "@/lib/admin/schema";

/*
  "Generate with AI" beside a field.

  Source values are read out of the live form rather than the saved row, so
  editing the summary and pressing generate uses what's on screen. Reading the
  database instead would quietly compress the previous version and look like
  the button had ignored the edit.

  The result is written into the field for review, not saved. Nothing the model
  produces reaches the database without the human pressing Save — same rule as
  the draft panel.
*/

export function GenerateButton({
  field,
  targetId,
}: {
  field: Field & { generate: NonNullable<Field["generate"]> };
  targetId: string;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [replaced, setReplaced] = useState<string | null>(null);

  function fieldValue(form: HTMLFormElement, name: string): string {
    const el = form.elements.namedItem(name);
    if (!el) return "";
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value;
    return "";
  }

  async function run() {
    const form = anchor.current?.closest("form");
    const target = form?.elements.namedItem(field.name);
    if (!form || !(target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement)) {
      setProblem("Couldn't find the field to fill.");
      return;
    }

    setBusy(true);
    setProblem("");

    const source: Record<string, string> = {};
    for (const name of field.generate.from) source[name] = fieldValue(form, name);

    const result = await requestShortSummary(source);
    setBusy(false);

    if (!result.ok) {
      setProblem(result.error);
      return;
    }

    // Keep the old text so an unwanted rewrite isn't a destructive click.
    setReplaced(target.value);
    target.value = result.text;
  }

  function undo() {
    const form = anchor.current?.closest("form");
    const target = form?.elements.namedItem(field.name);
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
      target.value = replaced ?? "";
    }
    setReplaced(null);
  }

  // One inline element: this sits in the label row, where a <p> would be
  // invalid markup and would also break the row's flex alignment.
  return (
    <span className="flex items-center gap-2">
      <button
        ref={anchor}
        type="button"
        onClick={run}
        disabled={busy}
        aria-controls={targetId}
        className="font-mono text-[11px] uppercase tracking-widest text-accent hover:underline disabled:opacity-50"
      >
        {busy ? "Writing…" : "Generate with AI"}
      </button>

      {replaced !== null && (
        <button
          type="button"
          onClick={undo}
          className="font-mono text-[11px] uppercase tracking-widest text-muted hover:text-text hover:underline"
        >
          Undo
        </button>
      )}

      {problem && <span className="text-xs normal-case tracking-normal text-danger">{problem}</span>}
    </span>
  );
}
