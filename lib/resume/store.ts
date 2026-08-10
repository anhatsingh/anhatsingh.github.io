import { openai } from "@ai-sdk/openai";
import { embed } from "ai";
import { getPublicClient, getServiceClient } from "@/lib/supabase/server";
import type { Resume, ResumeMeta } from "./schema";

/*
  Reading and writing saved resume variants.

  The public read goes through the anon client on purpose, so RLS decides what
  a visitor can see — the same rule the rest of the site is under. Writes use
  the service client behind an admin session.
*/

const EMBEDDING_MODEL = "text-embedding-3-small";

export interface StoredResume {
  slug: string;
  label: string;
  keywords: string[];
  pdfUrl: string;
  isDefault: boolean;
  embedding: number[] | null;
}

function mapRow(r: Record<string, unknown>): StoredResume {
  return {
    slug: r.slug as string,
    label: r.label as string,
    keywords: (r.keywords as string[]) ?? [],
    pdfUrl: r.pdf_url as string,
    isDefault: Boolean(r.is_default),
    // Supabase returns a vector column as a JSON string, not an array.
    embedding: parseEmbedding(r.embedding),
  };
}

function parseEmbedding(value: unknown): number[] | null {
  if (Array.isArray(value)) return value as number[];
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Published variants, for matching and for listing. RLS filters unpublished. */
export async function listPublishedResumes(): Promise<StoredResume[]> {
  const db = getPublicClient();
  if (!db) return [];

  const { data, error } = await db
    .from("resumes")
    .select("slug,label,keywords,pdf_url,is_default,embedding")
    .order("sort_order", { ascending: true });

  if (error) {
    // A missing table means the migration hasn't been run. The visitor path
    // must degrade to the static resume rather than error.
    console.error("[resume] list failed:", error.message);
    return [];
  }

  return (data ?? []).map(mapRow);
}

/** Everything, published or not — admin views only. */
export async function listAllResumes(): Promise<Array<StoredResume & { isPublished: boolean }>> {
  const db = getServiceClient();
  if (!db) return [];

  const { data, error } = await db
    .from("resumes")
    .select("slug,label,keywords,pdf_url,is_default,is_published,embedding")
    .order("sort_order", { ascending: true });

  if (error) return [];
  return (data ?? []).map((r) => ({ ...mapRow(r), isPublished: Boolean(r.is_published) }));
}

/**
 * Embeds what a variant is *for*, not what it says.
 *
 * The label and keywords are the description a recruiter's phrasing gets
 * compared against. Embedding the resume body instead would match on shared
 * vocabulary between two variants that both mention Python, which is exactly
 * the distinction that has to survive.
 */
async function embedKeywords(meta: Pick<ResumeMeta, "label" | "keywords">): Promise<number[] | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const { embedding } = await embed({
      model: openai.textEmbeddingModel(EMBEDDING_MODEL),
      value: `${meta.label}. ${meta.keywords.join(", ")}`,
    });
    return embedding;
  } catch (err) {
    console.error("[resume] embedding failed:", err);
    return null;
  }
}

export type SaveResult = { ok: true; slug: string } | { ok: false; error: string };

/**
 * Saves a variant and the posting it came from.
 *
 * Upsert on slug, so re-generating a variant replaces it and any link already
 * handed out keeps working. The job description goes to its own table, which
 * has no anon policy — see the comment on resume_sources in schema.sql.
 */
export async function saveResume(input: {
  meta: ResumeMeta;
  resume: Resume;
  pdfUrl: string;
  jobDescription: string;
  isDefault: boolean;
  isPublished: boolean;
}): Promise<SaveResult> {
  const db = getServiceClient();
  if (!db) return { ok: false, error: "Supabase isn't configured." };

  const embedding = await embedKeywords(input.meta);

  const { error } = await db.from("resumes").upsert(
    {
      slug: input.meta.slug,
      label: input.meta.label,
      keywords: input.meta.keywords,
      pdf_url: input.pdfUrl,
      resume_json: input.resume,
      embedding,
      is_default: input.isDefault,
      is_published: input.isPublished,
    },
    { onConflict: "slug" },
  );

  if (error) return { ok: false, error: error.message };

  /*
    Exactly one default. Done as a follow-up update rather than a constraint
    because a partial unique index would reject the write outright, and the
    admin's intent when ticking "default" is plainly to move it, not to fail.
  */
  if (input.isDefault) {
    await db.from("resumes").update({ is_default: false }).neq("slug", input.meta.slug);
  }

  if (input.jobDescription.trim()) {
    const { error: srcError } = await db
      .from("resume_sources")
      .insert({ resume_slug: input.meta.slug, job_description: input.jobDescription });
    // Losing the posting is not worth failing the save over — the resume and
    // its PDF are the artefact that matters.
    if (srcError) console.error("[resume] couldn't store the job description:", srcError.message);
  }

  return { ok: true, slug: input.meta.slug };
}
