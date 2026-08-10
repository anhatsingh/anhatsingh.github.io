import { getServiceClient } from "@/lib/supabase/server";

/*
  Image uploads, backed by Supabase Storage.

  No new service: the free tier includes 1GB, and the keys are already
  configured. Uploads go through the service-role client, so the bucket needs no
  write policy at all — the only way in is a server action that has already
  checked the admin session.

  The bucket is public-read because these are logos and cover images destined
  for a public page. Nothing private should ever be put here.
*/

export const MEDIA_BUCKET = "media";
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // 2MB

/*
  Generated resumes live in their own bucket.

  Not in `media`: that bucket is created with a 2MB limit and an image-only MIME
  allowlist, and those are fixed at creation time — an existing deployment would
  reject a PDF at the bucket even if this file allowed it. A second bucket also
  keeps the two kinds of asset separable if the retention rules ever differ.

  Public-read is correct here. These are documents meant to be handed to
  recruiters; the private thing is the job description that produced them, and
  that never leaves the database.
*/
export const RESUME_BUCKET = "resumes";
export const MAX_PDF_BYTES = 5 * 1024 * 1024; // 5MB

/*
  SVG is deliberately excluded.

  next/image refuses to optimise SVG unless `dangerouslyAllowSVG` is set, and
  that flag exists because an SVG is a document that can carry script. Allowing
  uploads of one would mean either a broken image or opening that hole for the
  sake of logo files that work fine as PNG.
*/
export const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

export interface UploadResult {
  ok: boolean;
  url?: string;
  error?: string;
}

/** Creates a bucket on first use, so there's no manual dashboard step. */
async function ensureBucket(
  db: NonNullable<ReturnType<typeof getServiceClient>>,
  name: string,
  limit: number,
  mimeTypes: string[],
) {
  const { data } = await db.storage.listBuckets();
  if (data?.some((b) => b.name === name)) return;

  await db.storage.createBucket(name, {
    public: true,
    fileSizeLimit: limit,
    allowedMimeTypes: mimeTypes,
  });
}

/**
 * Builds a storage path that's readable in the dashboard and can't collide.
 * The original name is slugified rather than kept: uploaded filenames arrive
 * with spaces, unicode and occasionally path separators in them.
 */
function storagePath(originalName: string, type: string): string {
  const ext = type.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
  const base = originalName
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60) || "image";

  return `${base}-${Date.now().toString(36)}.${ext}`;
}

export async function uploadImage(file: File): Promise<UploadResult> {
  const db = getServiceClient();
  if (!db) return { ok: false, error: "Supabase isn't configured (SUPABASE_SERVICE_ROLE_KEY)." };

  if (!file || file.size === 0) return { ok: false, error: "No file received." };

  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is 2MB — logos rarely need more.`,
    };
  }

  if (!ALLOWED_TYPES.includes(file.type as (typeof ALLOWED_TYPES)[number])) {
    return {
      ok: false,
      error: `${file.type || "That file type"} isn't supported. Use PNG, JPG, WebP or GIF — SVG can carry script, so it's not accepted.`,
    };
  }

  try {
    await ensureBucket(db, MEDIA_BUCKET, MAX_UPLOAD_BYTES, [...ALLOWED_TYPES]);

    const path = storagePath(file.name, file.type);
    const { error } = await db.storage
      .from(MEDIA_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });

    if (error) return { ok: false, error: error.message };

    const { data } = db.storage.from(MEDIA_BUCKET).getPublicUrl(path);
    return { ok: true, url: data.publicUrl };
  } catch (err) {
    console.error("[storage] upload failed:", err);
    return { ok: false, error: "Upload failed. Try again?" };
  }
}

/**
 * Stores a compiled resume PDF and returns its public URL.
 *
 * Takes bytes rather than a `File` because the PDF is produced server-side by
 * the compile service — there is no upload and no browser `File` involved.
 *
 * `upsert: true` so re-compiling a variant replaces it in place and every link
 * already handed out keeps working. The trade is that the old bytes are gone;
 * the structured object on the row is what makes that recoverable.
 */
export async function uploadResumePdf(bytes: Uint8Array, slug: string): Promise<UploadResult> {
  const db = getServiceClient();
  if (!db) return { ok: false, error: "Supabase isn't configured (SUPABASE_SERVICE_ROLE_KEY)." };

  if (!bytes.length) return { ok: false, error: "The compiler returned an empty file." };
  if (bytes.length > MAX_PDF_BYTES) {
    return {
      ok: false,
      error: `That PDF is ${(bytes.length / 1024 / 1024).toFixed(1)}MB. The limit is 5MB — a resume should be a fraction of that.`,
    };
  }

  // A PDF always starts with %PDF-. Catching a compiler that returned a log or
  // an error page here beats storing it and finding out on the public site.
  const header = new TextDecoder().decode(bytes.slice(0, 5));
  if (header !== "%PDF-") {
    return { ok: false, error: "That doesn't look like a PDF — the compiler probably failed." };
  }

  try {
    await ensureBucket(db, RESUME_BUCKET, MAX_PDF_BYTES, ["application/pdf"]);

    const path = `${slug}.pdf`;
    const { error } = await db.storage
      .from(RESUME_BUCKET)
      .upload(path, bytes, { contentType: "application/pdf", upsert: true });

    if (error) return { ok: false, error: error.message };

    const { data } = db.storage.from(RESUME_BUCKET).getPublicUrl(path);
    return { ok: true, url: data.publicUrl };
  } catch (err) {
    console.error("[storage] resume upload failed:", err);
    return { ok: false, error: "Couldn't store the PDF. Try again?" };
  }
}
