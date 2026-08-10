"use client";

import { useState } from "react";
import { ImageField } from "./image-field";
import { BLOCK_TYPES, parseBlocks, type Block, type BlockType } from "@/lib/content/blocks";

/*
  The block editor.

  Blocks live in React state and are posted as one JSON string in a hidden
  input, so the whole thing rides on the existing <form action={saveRow}> with
  no new submit path. `coerceRow` re-parses that JSON through `parseBlocks`
  server-side — the client is not trusted to have produced valid blocks.

  Deliberately not drag-and-drop. Move up/down covers reordering a ten-block
  post, works with a keyboard, and needs no dependency; a drag library would be
  the largest thing in the admin bundle for a control used a few times a month.
*/

const EMPTY: Record<BlockType, Block> = {
  text: { type: "text", markdown: "" },
  heading: { type: "heading", level: 2, text: "" },
  code: { type: "code", language: "python", code: "" },
  image: { type: "image", url: "", alt: "" },
  video: { type: "video", url: "" },
  github: { type: "github", repo: "" },
  link: { type: "link", url: "", title: "" },
  callout: { type: "callout", tone: "note", text: "" },
  steps: { type: "steps", steps: [{ title: "", body: "" }] },
  embed: { type: "embed", url: "", title: "" },
};

const input =
  "w-full rounded-[var(--radius)] border border-hairline bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent";
const label = "block font-mono text-[10px] uppercase tracking-widest text-muted";

function BlockFields({
  block,
  onChange,
}: {
  block: Block;
  onChange: (next: Block) => void;
}) {
  switch (block.type) {
    case "text":
      return (
        <div>
          <label className={label}>Markdown — bold, italic, links, `code`</label>
          <textarea
            rows={4}
            value={block.markdown}
            onChange={(e) => onChange({ ...block, markdown: e.target.value })}
            className={`mt-1 resize-y ${input}`}
          />
        </div>
      );

    case "heading":
      return (
        <div className="flex gap-2">
          <div className="w-24">
            <label className={label}>Level</label>
            <select
              value={block.level}
              onChange={(e) => onChange({ ...block, level: Number(e.target.value) as 2 | 3 })}
              className={`mt-1 ${input}`}
            >
              <option value={2}>H2</option>
              <option value={3}>H3</option>
            </select>
          </div>
          <div className="flex-1">
            <label className={label}>Text</label>
            <input
              value={block.text}
              onChange={(e) => onChange({ ...block, text: e.target.value })}
              className={`mt-1 ${input}`}
            />
          </div>
        </div>
      );

    case "code":
      return (
        <div className="space-y-2">
          <div className="flex gap-2">
            <div className="flex-1">
              <label className={label}>Language</label>
              <input
                value={block.language}
                onChange={(e) => onChange({ ...block, language: e.target.value })}
                className={`mt-1 ${input}`}
              />
            </div>
            <div className="flex-1">
              <label className={label}>Filename (optional)</label>
              <input
                value={block.filename ?? ""}
                onChange={(e) => onChange({ ...block, filename: e.target.value || undefined })}
                className={`mt-1 ${input}`}
              />
            </div>
          </div>
          <div>
            <label className={label}>Code</label>
            <textarea
              rows={6}
              value={block.code}
              onChange={(e) => onChange({ ...block, code: e.target.value })}
              className={`mt-1 resize-y font-mono ${input}`}
              spellCheck={false}
            />
          </div>
        </div>
      );

    case "image":
      return (
        <div className="space-y-2">
          <div>
            <label className={label}>Image</label>
            <ImageField
              id={`img-${block.url}`}
              name="__block_image"
              defaultValue={block.url}
              onValueChange={(url) => onChange({ ...block, url })}
            />
          </div>
          <div>
            <label className={label}>Alt text — required, describes the image</label>
            <input
              value={block.alt}
              onChange={(e) => onChange({ ...block, alt: e.target.value })}
              className={`mt-1 ${input}`}
            />
          </div>
          <div>
            <label className={label}>Caption (optional)</label>
            <input
              value={block.caption ?? ""}
              onChange={(e) => onChange({ ...block, caption: e.target.value || undefined })}
              className={`mt-1 ${input}`}
            />
          </div>
        </div>
      );

    case "video":
      return (
        <div className="space-y-2">
          <div>
            <label className={label}>URL — YouTube, Vimeo or a direct .mp4</label>
            <input
              value={block.url}
              onChange={(e) => onChange({ ...block, url: e.target.value })}
              className={`mt-1 ${input}`}
            />
          </div>
          <div>
            <label className={label}>Caption (optional)</label>
            <input
              value={block.caption ?? ""}
              onChange={(e) => onChange({ ...block, caption: e.target.value || undefined })}
              className={`mt-1 ${input}`}
            />
          </div>
        </div>
      );

    case "github":
      return (
        <div className="space-y-2">
          <div>
            <label className={label}>Repo — owner/name</label>
            <input
              value={block.repo}
              onChange={(e) => onChange({ ...block, repo: e.target.value })}
              placeholder="anhatsingh/rag-eval"
              className={`mt-1 font-mono ${input}`}
            />
          </div>
          <div>
            <label className={label}>Note (optional) — overrides the repo description</label>
            <input
              value={block.note ?? ""}
              onChange={(e) => onChange({ ...block, note: e.target.value || undefined })}
              className={`mt-1 ${input}`}
            />
          </div>
        </div>
      );

    case "link":
      return (
        <div className="space-y-2">
          <div>
            <label className={label}>URL</label>
            <input
              value={block.url}
              onChange={(e) => onChange({ ...block, url: e.target.value })}
              className={`mt-1 ${input}`}
            />
          </div>
          <div>
            <label className={label}>Title</label>
            <input
              value={block.title}
              onChange={(e) => onChange({ ...block, title: e.target.value })}
              className={`mt-1 ${input}`}
            />
          </div>
          <div>
            <label className={label}>Description (optional)</label>
            <input
              value={block.description ?? ""}
              onChange={(e) => onChange({ ...block, description: e.target.value || undefined })}
              className={`mt-1 ${input}`}
            />
          </div>
        </div>
      );

    case "callout":
      return (
        <div className="space-y-2">
          <div className="w-40">
            <label className={label}>Tone</label>
            <select
              value={block.tone}
              onChange={(e) =>
                onChange({ ...block, tone: e.target.value as "note" | "warning" | "success" })
              }
              className={`mt-1 ${input}`}
            >
              <option value="note">Note</option>
              <option value="warning">Watch out</option>
              <option value="success">Result</option>
            </select>
          </div>
          <div>
            <label className={label}>Text</label>
            <textarea
              rows={3}
              value={block.text}
              onChange={(e) => onChange({ ...block, text: e.target.value })}
              className={`mt-1 resize-y ${input}`}
            />
          </div>
        </div>
      );

    case "steps":
      return (
        <div className="space-y-3">
          {block.steps.map((step, i) => (
            <div key={i} className="rounded-[var(--radius)] border border-hairline p-2.5">
              <div className="flex items-center justify-between">
                <span className={label}>Step {i + 1}</span>
                {block.steps.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      onChange({ ...block, steps: block.steps.filter((_, j) => j !== i) })
                    }
                    className="font-mono text-[10px] uppercase tracking-widest text-muted hover:text-danger"
                  >
                    remove
                  </button>
                )}
              </div>
              <input
                value={step.title}
                placeholder="Title"
                onChange={(e) =>
                  onChange({
                    ...block,
                    steps: block.steps.map((s, j) => (j === i ? { ...s, title: e.target.value } : s)),
                  })
                }
                className={`mt-1.5 ${input}`}
              />
              <textarea
                rows={2}
                value={step.body}
                placeholder="What to do"
                onChange={(e) =>
                  onChange({
                    ...block,
                    steps: block.steps.map((s, j) => (j === i ? { ...s, body: e.target.value } : s)),
                  })
                }
                className={`mt-1.5 resize-y ${input}`}
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() => onChange({ ...block, steps: [...block.steps, { title: "", body: "" }] })}
            className="font-mono text-[11px] uppercase tracking-widest text-accent hover:underline"
          >
            + step
          </button>
        </div>
      );

    case "embed":
      return (
        <div className="space-y-2">
          <div>
            <label className={label}>URL — a demo, a Space, a notebook</label>
            <input
              value={block.url}
              onChange={(e) => onChange({ ...block, url: e.target.value })}
              className={`mt-1 ${input}`}
            />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className={label}>Title — announced to screen readers</label>
              <input
                value={block.title}
                onChange={(e) => onChange({ ...block, title: e.target.value })}
                className={`mt-1 ${input}`}
              />
            </div>
            <div className="w-32">
              <label className={label}>Height (px)</label>
              <input
                type="number"
                value={block.height ?? 460}
                onChange={(e) => onChange({ ...block, height: Number(e.target.value) || undefined })}
                className={`mt-1 ${input}`}
              />
            </div>
          </div>
        </div>
      );
  }
}

/** One-line gist for the collapsed header, so a long body stays scannable. */
function summarise(block: Block): string {
  switch (block.type) {
    case "text": return block.markdown.slice(0, 60) || "empty";
    case "heading": return block.text || "empty";
    case "code": return block.filename ?? block.language;
    case "image": return block.alt || block.url || "empty";
    case "video": return block.caption ?? (block.url || "empty");
    case "github": return block.repo || "empty";
    case "link": return block.title || block.url || "empty";
    case "callout": return block.text.slice(0, 60) || "empty";
    case "steps": return `${block.steps.length} step${block.steps.length === 1 ? "" : "s"}`;
    case "embed": return block.title || block.url || "empty";
  }
}

export function BlockEditor({ name, defaultValue }: { name: string; defaultValue: unknown }) {
  const [blocks, setBlocks] = useState<Block[]>(() => parseBlocks(defaultValue));
  const [adding, setAdding] = useState(false);

  const update = (i: number, next: Block) =>
    setBlocks((prev) => prev.map((b, j) => (j === i ? next : b)));

  const move = (i: number, delta: number) =>
    setBlocks((prev) => {
      const next = [...prev];
      const target = i + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[i], next[target]] = [next[target], next[i]];
      return next;
    });

  return (
    <div className="mt-1.5 space-y-3">
      {/* The whole body posts as one field; the server re-validates it. */}
      <input type="hidden" name={name} value={JSON.stringify(blocks)} readOnly />

      {blocks.length === 0 && (
        <p className="text-xs text-muted">
          No body yet. The page will show its structured details and say so.
        </p>
      )}

      {blocks.map((block, i) => (
        <details
          key={i}
          open={blocks.length <= 3}
          className="group rounded-[var(--radius)] border border-hairline bg-surface"
        >
          <summary className="flex cursor-pointer items-center gap-2 px-3 py-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-accent">
              {block.type}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted">{summarise(block)}</span>
            <span className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); move(i, -1); }}
                disabled={i === 0}
                aria-label="Move up"
                className="px-1 font-mono text-xs text-muted hover:text-accent disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); move(i, 1); }}
                disabled={i === blocks.length - 1}
                aria-label="Move down"
                className="px-1 font-mono text-xs text-muted hover:text-accent disabled:opacity-30"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  setBlocks((prev) => prev.filter((_, j) => j !== i));
                }}
                aria-label="Delete block"
                className="px-1 font-mono text-xs text-muted hover:text-danger"
              >
                ✕
              </button>
            </span>
          </summary>
          <div className="border-t border-hairline p-3">
            <BlockFields block={block} onChange={(next) => update(i, next)} />
          </div>
        </details>
      ))}

      {adding ? (
        <div className="rounded-[var(--radius)] border border-accent/40 bg-surface p-3">
          <div className="flex items-center justify-between">
            <span className={label}>Add a block</span>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="font-mono text-[10px] uppercase tracking-widest text-muted hover:text-text"
            >
              cancel
            </button>
          </div>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {BLOCK_TYPES.map((meta) => (
              <button
                key={meta.type}
                type="button"
                onClick={() => {
                  setBlocks((prev) => [...prev, structuredClone(EMPTY[meta.type])]);
                  setAdding(false);
                }}
                className="rounded-[var(--radius)] border border-hairline px-2.5 py-2 text-left transition-colors hover:border-accent"
              >
                <span className="block text-xs text-text">{meta.label}</span>
                <span className="block text-[11px] text-muted">{meta.hint}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="w-full rounded-[var(--radius)] border border-dashed border-hairline px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted transition-colors hover:border-accent hover:text-accent"
        >
          + add block
        </button>
      )}
    </div>
  );
}
