"use client";

import { useRef, useState, useTransition } from "react";
import { uploadMedia } from "@/app/admin/actions";

/*
  A URL input that can also upload.

  Pasting a URL still works — that's the escape hatch for images already hosted
  somewhere, and for Google's favicon service, which is the easiest source for
  company logos. The upload button exists because "paste a URL" is useless when
  you have a file on your laptop and nowhere to put it.

  The preview matters more than it looks: a wrong or dead URL is invisible in a
  text field and only shows up on the live site. Seeing the image here means a
  broken link is caught before saving rather than after.
*/

export function ImageField({
  id,
  name,
  defaultValue,
  required,
  help,
  onValueChange,
}: {
  id: string;
  name: string;
  defaultValue: string;
  required?: boolean;
  help?: string;
  /**
   * Set when the field is embedded in something that owns its own state — the
   * block editor. Without it the value lives only in this component and the
   * hidden form input, which is fine for a plain row but loses the value when a
   * block re-renders.
   */
  onValueChange?: (url: string) => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const [pending, startTransition] = useTransition();
  const [problem, setProblem] = useState("");
  const [broken, setBroken] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function choose(file: File | undefined) {
    if (!file) return;
    setProblem("");

    const formData = new FormData();
    formData.set("file", file);

    startTransition(async () => {
      const result = await uploadMedia(formData);
      if (!result.ok || !result.url) {
        setProblem(result.error ?? "Upload failed.");
        return;
      }
      setValue(result.url);
      onValueChange?.(result.url);
      setBroken(false);
    });
  }

  return (
    <div className="mt-1.5">
      <div className="flex gap-2">
        <input
          id={id}
          name={name}
          type="text"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            onValueChange?.(e.target.value);
            setBroken(false);
          }}
          required={required}
          placeholder="Paste a URL, or upload →"
          className="min-w-0 flex-1 rounded-[var(--radius)] border border-hairline bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={pending}
          className="shrink-0 rounded-[var(--radius)] border border-hairline px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
        >
          {pending ? "Uploading…" : "Upload"}
        </button>

        {value && (
          <button
            type="button"
            onClick={() => {
              setValue("");
              onValueChange?.("");
              setProblem("");
              setBroken(false);
            }}
            className="shrink-0 px-2 font-mono text-[11px] uppercase tracking-widest text-muted hover:text-danger"
          >
            clear
          </button>
        )}
      </div>

      {/* Hidden until clicked — a bare file input can't be styled to match. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={(e) => {
          choose(e.target.files?.[0]);
          // Reset so re-picking the same file still fires a change event.
          e.target.value = "";
        }}
        className="hidden"
      />

      {problem && <p className="mt-1.5 text-xs text-danger">{problem}</p>}

      {value && !problem && (
        <div className="mt-2 flex items-center gap-3">
          {/* Plain <img>, not next/image: this is admin-only, the source is
              arbitrary, and an onError fallback is more useful here than
              optimisation. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt=""
            onError={() => setBroken(true)}
            onLoad={() => setBroken(false)}
            className={`h-12 w-12 rounded-[var(--radius)] border border-hairline bg-white object-contain p-1 ${
              broken ? "hidden" : ""
            }`}
          />
          {broken && (
            <span className="font-mono text-xs text-danger">
              That URL doesn&apos;t load as an image.
            </span>
          )}
          <span className="min-w-0 truncate font-mono text-[11px] text-muted">{value}</span>
        </div>
      )}

      {help && <p className="mt-1 text-xs text-muted">{help}</p>}
      <p className="mt-1 text-xs text-muted">PNG, JPG, WebP or GIF · 2MB max.</p>
    </div>
  );
}
