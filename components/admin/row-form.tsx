"use client";

import { useState, useTransition } from "react";
import { deleteRow, saveRow } from "@/app/admin/actions";
import type { TableSpec } from "@/lib/admin/schema";

/*
  One generic form, driven by the field schema. Every section reuses it, so
  adding a column to a table means editing lib/admin/schema.ts and nothing else.
*/

type Row = Record<string, unknown>;

function valueFor(field: { name: string; type: string }, row: Row | null): string {
  const raw = row?.[field.name];
  if (raw == null) return "";
  if (field.type === "list") return Array.isArray(raw) ? raw.join("\n") : String(raw);
  return String(raw);
}

export function RowForm({
  spec,
  row,
  onDone,
}: {
  spec: TableSpec;
  row: Row | null;
  onDone?: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [problem, setProblem] = useState("");
  const [saved, setSaved] = useState(false);
  const id = (row?.id as string) ?? null;
  const isNew = !id && !spec.singleton;

  function submit(formData: FormData) {
    setProblem("");
    setSaved(false);
    startTransition(async () => {
      const result = await saveRow(spec.key, id, formData);
      if (!result.ok) {
        setProblem(result.error);
        return;
      }
      setSaved(true);
      onDone?.();
    });
  }

  function remove() {
    if (!id) return;
    if (!confirm("Delete this permanently?")) return;
    startTransition(async () => {
      const result = await deleteRow(spec.key, id);
      if (!result.ok) setProblem(result.error);
      else onDone?.();
    });
  }

  return (
    <form action={submit} className="space-y-4">
      {spec.fields.map((field) => {
        const locked = field.lockedAfterCreate && !isNew && !spec.singleton;
        const common =
          "w-full rounded-[var(--radius)] border border-hairline bg-surface px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-50";

        // Hidden platform keys arrive as an array on the row; the toggle below
        // reflects membership rather than a per-platform boolean column.
        const hiddenKeys = Array.isArray(row?.hidden_socials)
          ? (row.hidden_socials as string[])
          : [];

        return (
          <div key={field.name}>
            <div className="flex items-baseline justify-between gap-3">
              <label
                htmlFor={`${spec.key}-${id ?? "new"}-${field.name}`}
                className="block font-mono text-[11px] uppercase tracking-widest text-muted"
              >
                {field.label}
                {field.required && <span className="text-accent"> *</span>}
              </label>

              {field.hideKey && (
                <label className="flex cursor-pointer select-none items-center gap-1.5 font-mono text-[11px] uppercase tracking-widest text-muted hover:text-text">
                  <input
                    type="checkbox"
                    name={`hidden__${field.hideKey}`}
                    defaultChecked={hiddenKeys.includes(field.hideKey)}
                    className="h-3.5 w-3.5 accent-[var(--accent)]"
                  />
                  Hide
                </label>
              )}
            </div>

            {field.type === "boolean" ? (
              <input
                id={`${spec.key}-${id ?? "new"}-${field.name}`}
                name={field.name}
                type="checkbox"
                defaultChecked={Boolean(row?.[field.name] ?? field.name === "is_published")}
                className="mt-1.5 h-4 w-4 accent-[var(--accent)]"
              />
            ) : field.type === "textarea" || field.type === "list" ? (
              <textarea
                id={`${spec.key}-${id ?? "new"}-${field.name}`}
                name={field.name}
                rows={field.type === "list" ? 4 : 5}
                defaultValue={valueFor(field, row)}
                required={field.required}
                className={`mt-1.5 resize-y ${common}`}
              />
            ) : (
              <input
                id={`${spec.key}-${id ?? "new"}-${field.name}`}
                name={field.name}
                type={field.type === "number" ? "number" : field.type === "email" ? "email" : "text"}
                defaultValue={valueFor(field, row)}
                required={field.required}
                disabled={locked}
                className={`mt-1.5 ${common}`}
              />
            )}

            {/* Locked slugs still need to post, or the update would clear them. */}
            {locked && <input type="hidden" name={field.name} value={valueFor(field, row)} />}

            {field.help && <p className="mt-1 text-xs text-muted">{field.help}</p>}

            {field.name === "resume_url" && valueFor(field, row) && (
              <a
                href={valueFor(field, row)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block font-mono text-xs uppercase tracking-widest text-accent hover:underline"
              >
                test link →
              </a>
            )}
          </div>
        );
      })}

      {problem && <p className="text-sm text-danger">{problem}</p>}
      {saved && <p className="text-sm text-success">Saved.</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius)] bg-accent px-4 py-2 font-mono text-xs uppercase tracking-widest text-accent-ink disabled:opacity-50"
        >
          {pending ? "Saving…" : isNew ? "Create" : "Save"}
        </button>
        {id && !spec.singleton && (
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            className="font-mono text-xs uppercase tracking-widest text-muted hover:text-danger"
          >
            delete
          </button>
        )}
      </div>
    </form>
  );
}
