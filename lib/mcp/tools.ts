import { z } from "zod";
import { getPortfolio } from "@/lib/content";
import { getDetail, getAllDetailPaths } from "@/lib/content/entities";
import { blocksToPlainText } from "@/lib/content/blocks";
import { skillTenure } from "@/lib/content/skill-tenure";
import { retrieve } from "@/lib/chat/embeddings";
import { listPublishedResumes } from "@/lib/resume/store";
import { assessFitAgainst } from "@/lib/mcp/fit";
import { entityPath, itemId, parseItemId, socialLinks, type EntityType } from "@/lib/content/types";
import { SITE_URL } from "@/lib/seo";

/*
  What another agent can pull.

  Every one of these reads through the same paths the website does, so RLS is
  the same boundary: an agent sees exactly what a visitor sees, and unpublished
  rows are invisible because Postgres says so rather than because a filter here
  remembered to exclude them. The token decides who may connect and who spends
  the compute — never what is visible.

  Whole datasets rather than a search box. An agent asked to write a cover
  letter or check a fit wants the record, not three excerpts, and paginating a
  portfolio would be inventing a problem.

  Nothing here is new logic. getPortfolio, getDetail, retrieve, skillTenure and
  listPublishedResumes are the same functions the site runs on, already tested.
  This file is a protocol wrapper.
*/

/** MCP wants content parts; JSON is what an agent can actually use. */
function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

/*
  Bodies flattened to text.

  The stored form is a block tree, which is a rendering concern — an agent
  reading it would have to learn a private schema to get at prose. This is the
  same flattening the search index uses.
*/
function withBody<T extends { body?: unknown[] }>(row: T, type: EntityType, slug: string) {
  const { body, ...rest } = row as T & Record<string, unknown>;
  return {
    ...rest,
    id: itemId(type === "posts" ? "writing" : type, slug),
    url: `${SITE_URL}${entityPath(type, slug)}`,
    writeUp: body?.length ? blocksToPlainText(body as never) : null,
  };
}

export interface McpTool {
  name: string;
  description: string;
  /*
    A zod object, not a loose ZodType. The SDK reads `~standard.jsonSchema` off
    it to advertise arguments in tools/list and `~standard.validate` to check a
    tools/call before we see it — so argument validation is the library's, not
    something re-implemented in every run().
  */
  inputSchema: z.ZodObject<z.ZodRawShape>;
  run: (args: never) => Promise<{ content: Array<{ type: "text"; text: string }> }>;
}

export const MCP_TOOLS: McpTool[] = [
  {
    name: "get_profile",
    description:
      "Who this is: name, headline, current focus, location, availability and every public profile link. Start here.",
    inputSchema: z.object({}),
    run: async () => {
      const { profile } = await getPortfolio();
      return json({
        name: profile.name,
        headline: profile.headline,
        tagline: profile.tagline,
        bio: profile.bio,
        location: profile.location ?? null,
        email: profile.email,
        openToWork: profile.openToWork,
        site: SITE_URL,
        links: socialLinks(profile).map((l) => ({ platform: l.key, label: l.label, url: l.url })),
      });
    },
  },

  {
    name: "list_experience",
    description:
      "Every published role, in full — company, dates, summary, highlights, technologies, and the write-up where one exists.",
    inputSchema: z.object({}),
    run: async () => {
      const { experience } = await getPortfolio();
      return json(experience.map((e) => withBody(e, "experience", e.slug)));
    },
  },

  {
    name: "list_projects",
    description: "Every published project in full, with its description, technologies and write-up.",
    inputSchema: z.object({}),
    run: async () => {
      const { projects } = await getPortfolio();
      return json(projects.map((p) => withBody(p, "projects", p.slug)));
    },
  },

  {
    name: "list_education",
    description: "Degrees and schooling, with what each involved where that has been written up.",
    inputSchema: z.object({}),
    run: async () => {
      const { education } = await getPortfolio();
      return json(education.map((e) => withBody(e, "education", e.slug)));
    },
  },

  {
    name: "list_skills",
    description:
      "Every skill, grouped by the heading it appears under on the site. Use skill_duration for how long one has actually been used.",
    inputSchema: z.object({}),
    run: async () => {
      const { skills } = await getPortfolio();
      return json(skills.map((s) => withBody(s, "skills", s.slug)));
    },
  },

  {
    name: "list_certifications",
    description: "Certifications and test scores, with issuer, date and credential link.",
    inputSchema: z.object({}),
    run: async () => {
      const { certifications } = await getPortfolio();
      return json(certifications.map((c) => withBody(c, "certifications", c.slug)));
    },
  },

  {
    name: "list_writing",
    description: "Published posts, with the full text of anything hosted on this site.",
    inputSchema: z.object({}),
    run: async () => {
      const { writing } = await getPortfolio();
      return json(writing.map((w) => withBody(w, "posts", w.slug)));
    },
  },

  {
    name: "get_entry",
    description:
      "One entry in full by its id, e.g. 'experience:data-scientist-axtria'. Ids come back from every list tool.",
    inputSchema: z.object({
      id: z.string().describe("An id from a list tool, in the form 'type:slug'."),
    }),
    run: async ({ id }: { id: string }) => {
      const parsed = parseItemId(id);
      if (!parsed) return json({ error: `Not an id: ${id}. They look like 'projects:some-slug'.` });

      const type = (parsed.section === "writing" ? "posts" : parsed.section) as EntityType;
      const view = await getDetail(type, parsed.slug);
      if (!view) return json({ error: `Nothing published under ${id}.` });

      return json({
        id,
        title: view.title,
        subtitle: view.subtitle ?? null,
        summary: view.summary,
        highlights: view.highlights ?? [],
        tech: view.tech,
        meta: view.meta,
        url: `${SITE_URL}${view.path}`,
        writeUp: view.body.length ? blocksToPlainText(view.body) : null,
      });
    },
  },

  {
    name: "search",
    description:
      "Semantic search across every write-up on the site — the same retrieval the site's own assistant uses. For a specific question rather than a whole dataset.",
    inputSchema: z.object({
      query: z.string().min(3).describe("What you're looking for, in natural language."),
      limit: z.number().int().min(1).max(20).default(5),
    }),
    run: async ({ query, limit }: { query: string; limit: number }) => {
      const chunks = await retrieve(query, limit);
      return json(
        chunks.map((c) => ({
          id: itemId(c.sourceType === "posts" ? "writing" : (c.sourceType as never), c.sourceSlug),
          url: `${SITE_URL}${entityPath(c.sourceType as EntityType, c.sourceSlug)}`,
          excerpt: c.content,
          similarity: Number(c.similarity.toFixed(3)),
        })),
      );
    },
  },

  {
    name: "skill_duration",
    description:
      "How long a technology has actually been used, computed from the dated jobs and projects that name it, with overlapping months counted once. Answers honestly when nothing dated uses it.",
    inputSchema: z.object({
      skill: z.string().describe("Just the name — 'Python', not 'Python experience'."),
    }),
    run: async ({ skill }: { skill: string }) => {
      const portfolio = await getPortfolio();
      const tenure = skillTenure(portfolio, skill);
      return json({
        skill: tenure.skill,
        months: tenure.months,
        formatted: tenure.formatted,
        stillInUse: tenure.ongoing,
        spans: tenure.spans,
        undatedEntries: tenure.undated,
        summary: tenure.summary,
      });
    },
  },

  {
    name: "list_resumes",
    description: "The published CVs and their direct links.",
    inputSchema: z.object({}),
    run: async () => {
      const resumes = await listPublishedResumes();
      return json(resumes.map((r) => ({ label: r.label, url: r.pdfUrl, keywords: r.keywords })));
    },
  },

  {
    name: "assess_fit",
    description:
      "Judge him against a job description: a verdict, the requirements the record can evidence, and the ones it cannot. The gaps are the point — an assessment that matches everything is worth nothing to whoever reads it.",
    inputSchema: z.object({
      jobDescription: z.string().min(40).max(8000).describe("The posting, pasted in full."),
    }),
    run: async ({ jobDescription }: { jobDescription: string }) => {
      const result = await assessFitAgainst(jobDescription);
      return json(result);
    },
  },

  {
    name: "list_urls",
    description: "Every page on the site, for crawling or citing.",
    inputSchema: z.object({}),
    run: async () => {
      const paths = await getAllDetailPaths();
      return json(paths.map((p) => `${SITE_URL}${p}`));
    },
  },
];
