import { openai } from "@ai-sdk/openai";
import { embed, embedMany } from "ai";
import { blocksToPlainText, type Block } from "@/lib/content/blocks";
import { getServiceClient } from "@/lib/supabase/server";
import { entityPath, type EntityType } from "@/lib/content/types";

/*
  Embedding and retrieval for long-form bodies.

  text-embedding-3-small: 1536 dimensions, and cheap enough that re-embedding
  the whole site costs a fraction of a cent. The dimension is baked into the
  content_chunks column, so switching models means a migration plus a full
  reindex — not a config change.

  Everything here fails soft. A chat reply without retrieved context is worse
  than one with it; a chat reply that 500s because the vector store was
  unreachable is worse than both.
*/

const EMBEDDING_MODEL = "text-embedding-3-small";
const TARGET_CHUNK_CHARS = 900;

export interface RetrievedChunk {
  sourceType: string;
  sourceSlug: string;
  content: string;
  similarity: number;
}

/**
 * Splits text into chunks on paragraph boundaries.
 *
 * `blocksToPlainText` joins blocks with a blank line, so splitting on those
 * keeps a chunk aligned to whole blocks wherever possible — a code sample's
 * description doesn't end up severed from the sentence introducing it. Only a
 * single paragraph longer than the target gets hard-split.
 */
export function chunkText(text: string, targetChars = TARGET_CHUNK_CHARS): string[] {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (paragraph.length > targetChars) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      // A single oversized paragraph: split on sentence ends, not mid-word.
      const sentences = paragraph.match(/[^.!?]+[.!?]+|\S+$/g) ?? [paragraph];
      let buffer = "";
      for (const sentence of sentences) {
        if (buffer.length + sentence.length > targetChars && buffer) {
          chunks.push(buffer.trim());
          buffer = "";
        }
        buffer += sentence;
      }
      if (buffer.trim()) chunks.push(buffer.trim());
      continue;
    }

    if (current.length + paragraph.length + 2 > targetChars && current) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

/**
 * Re-embeds one entity. Fire-and-forget from saveRow — never awaited, never
 * throws, because a failure to index must not fail a save.
 */
export async function reindexEntity(
  sourceType: EntityType,
  sourceSlug: string,
  title: string,
  body: Block[],
): Promise<void> {
  const db = getServiceClient();
  if (!db || !process.env.OPENAI_API_KEY) return;

  try {
    // Always clear first. An edit that shortens a body would otherwise leave
    // the old tail chunks behind, and the bot would quote deleted text.
    await db.from("content_chunks").delete().match({ source_type: sourceType, source_slug: sourceSlug });

    const text = blocksToPlainText(body);
    if (!text.trim()) return;

    // Every chunk is prefixed with what it's from. Without it a retrieved
    // fragment arrives context-free and the model can't say where it came from.
    const chunks = chunkText(text).map((c) => `${title}\n\n${c}`);
    if (!chunks.length) return;

    const { embeddings } = await embedMany({
      model: openai.textEmbeddingModel(EMBEDDING_MODEL),
      values: chunks,
    });

    await db.from("content_chunks").insert(
      chunks.map((content, i) => ({
        source_type: sourceType,
        source_slug: sourceSlug,
        chunk_index: i,
        content,
        embedding: embeddings[i],
      })),
    );
  } catch (err) {
    console.error(`[embeddings] reindex failed for ${sourceType}:${sourceSlug}`, err);
  }
}

/** Retrieves the chunks most similar to a question. Returns [] on any failure. */
export async function retrieve(question: string, limit = 5): Promise<RetrievedChunk[]> {
  const db = getServiceClient();
  if (!db || !process.env.OPENAI_API_KEY) return [];
  if (question.trim().length < 3) return [];

  try {
    const { embedding } = await embed({
      model: openai.textEmbeddingModel(EMBEDDING_MODEL),
      value: question,
    });

    const { data, error } = await db.rpc("match_content_chunks", {
      query_embedding: embedding,
      match_count: limit,
    });

    if (error) {
      // Most likely the extension or function isn't installed yet. Summaries
      // are still in the prompt, so the bot degrades rather than breaking.
      console.error("[embeddings] retrieval unavailable:", error.message);
      return [];
    }

    return (data ?? []).map((row: Record<string, unknown>) => ({
      sourceType: row.source_type as string,
      sourceSlug: row.source_slug as string,
      content: row.content as string,
      similarity: Number(row.similarity),
    }));
  } catch (err) {
    console.error("[embeddings] retrieval failed:", err);
    return [];
  }
}

/** Formats retrieved chunks for the prompt, with the URL so the bot can link. */
export function formatRetrieved(chunks: RetrievedChunk[]): string {
  if (!chunks.length) return "";

  const body = chunks
    .map((c) => {
      const path = entityPath(c.sourceType as EntityType, c.sourceSlug);
      return `--- from ${c.sourceType}:${c.sourceSlug} (${path})\n${c.content}`;
    })
    .join("\n\n");

  return `## RETRIEVED DETAIL
These excerpts come from full write-ups on the site and were selected as relevant to this question. They are the deepest source available — prefer them over summaries when answering "how" questions, and link to the page they came from.

${body}`;
}
