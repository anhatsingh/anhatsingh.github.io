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

/** Creates the bucket on first use, so there's no manual dashboard step. */
async function ensureBucket(db: NonNullable<ReturnType<typeof getServiceClient>>) {
  const { data } = await db.storage.listBuckets();
  if (data?.some((b) => b.name === MEDIA_BUCKET)) return;

  await db.storage.createBucket(MEDIA_BUCKET, {
    public: true,
    fileSizeLimit: MAX_UPLOAD_BYTES,
    allowedMimeTypes: [...ALLOWED_TYPES],
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
    await ensureBucket(db);

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
