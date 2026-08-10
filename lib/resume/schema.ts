import { z } from "zod";

/*
  The shape of a resume, as data.

  The model fills this in; it never writes LaTeX. One unbalanced brace from a
  language model is an unrecoverable compile failure, and model-authored markup
  can reach \input and \write18 — so the split is absolute: the model proposes
  a typed object, lib/resume/render.ts owns every backslash.

  The fields mirror the macros in template.tex almost one-to-one, because those
  macros already are a data model: \resumeSubheadingSingleLine{company}{title}
  {dates} is a three-field record with a bullet list attached.
*/

/*
  Emphasis is data, not markup.

  The template bolds phrases inside bullets. Rather than let the model emit
  \textbf{...}, it names the phrases it wants emphasised and the renderer
  escapes first and wraps second. A phrase that isn't a verbatim substring is
  dropped rather than guessed at.

  The cap is three. In the source template nearly every noun phrase is bold,
  which flattens emphasis into texture — when everything is emphasised nothing
  is, and a human skimming reads keyword-stuffing rather than signal.
*/
/*
  Nullable rather than optional, throughout this file.

  OpenAI's structured-output mode requires every property to appear in the
  schema's `required` array — an optional field is rejected outright with
  "'required' is required to be supplied and to be an array including every key
  in properties". Nullable gives the same "there may be nothing here" meaning in
  a shape the API accepts, and the renderer treats null and absent identically.

  Defaults are gone for the same reason: the model supplies every field, even
  when the answer is an empty array.
*/
export const richTextSchema = z.object({
  text: z.string().min(1).max(400),
  emphasise: z
    .array(z.string().min(2).max(60))
    .max(3)
    .describe("Phrases to bold. Each MUST appear verbatim in `text`, or it is dropped. May be empty."),
});

export type RichText = z.infer<typeof richTextSchema>;

/*
  Every bullet names the database row it came from.

  This is the anti-fabrication guard: after generation, any bullet whose
  sourceId doesn't resolve to a real entity is dropped. It's the same trick
  lib/chat/tools.ts uses on item ids, where an unknown id comes back with the
  valid list so the model self-corrects.
*/
export const bulletSchema = richTextSchema.extend({
  sourceId: z
    .string()
    .min(1)
    .describe("id of the experience/project row this came from, e.g. 'experience:my-slug'"),
});

export type Bullet = z.infer<typeof bulletSchema>;

export const resumeSchema = z.object({
  header: z.object({
    name: z.string().min(1).max(80),
    location: z.string().max(80).nullable().describe("City, Country. ATS parse a location field. Null if unknown."),
    phone: z.string().max(30).nullable().describe("Include the country code. Null if unknown."),
    email: z.string().max(120),
    linkedin: z.string().max(200).nullable().describe("Bare host+path, no scheme. Null if unknown."),
    github: z.string().max(200).nullable().describe("Bare host+path, no scheme. Null if unknown."),
  }),

  summary: richTextSchema.describe(
    "Two or three sentences positioning him for THIS role, drawn only from real material.",
  ),

  education: z
    .array(
      z.object({
        degree: z.string().min(1).max(120),
        institution: z.string().min(1).max(160),
        score: z.string().max(40).nullable().describe("e.g. '9.26 CGPA'. Null if none."),
        years: z.string().min(1).max(40).describe("e.g. '2021 - 2025'"),
      }),
    )
    .max(6),

  /*
    Flat: one entry per real position, no nested project headings.

    The source template nests project headings inside an experience entry,
    which reads beautifully and parses badly — employment history is the field
    ATS extract most aggressively, and a bolded heading between a company line
    and its bullets can turn two roles into four positions. Client work is
    named inside the bullet instead, or moved to `projects`.
  */
  experience: z
    .array(
      z.object({
        company: z.string().min(1).max(120),
        title: z.string().min(1).max(120),
        dates: z.string().min(1).max(60).describe("e.g. 'Nov 2024 - Jan 2026' or 'Mar 2026 - Present'"),
        bullets: z.array(bulletSchema).min(1).max(8),
      }),
    )
    .max(8),

  projects: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        context: z.string().max(160).nullable().describe("e.g. 'Course Project | IIT Madras'. Null if none."),
        dates: z.string().max(60).nullable(),
        bullets: z.array(bulletSchema).min(1).max(4),
      }),
    )
    .max(6),

  skills: z
    .array(
      z.object({
        label: z.string().min(1).max(40).describe("e.g. 'Languages', 'Backend'"),
        items: z.string().min(1).max(400).describe("Comma-separated, in one line."),
      }),
    )
    .max(8),

  achievements: z.array(richTextSchema).max(5).describe("May be empty."),
});

export type Resume = z.infer<typeof resumeSchema>;

/*
  Keywords describe the role a saved variant targets, and are what a visitor's
  stated interest is matched against. Generated alongside the resume, edited by
  a human before saving.
*/
export const resumeMetaSchema = z.object({
  label: z
    .string()
    .min(1)
    .max(60)
    .describe("Short human name for this variant, e.g. 'Backend & Distributed Systems'."),
  slug: z.string().min(1).max(60).describe("kebab-case, stable, used in the PDF filename."),
  keywords: z
    .array(z.string().min(2).max(40))
    .min(3)
    .max(20)
    .describe(
      "Role families, technologies and seniority a hiring manager might say. Include the " +
        "spellings people actually use — 'ML', 'machine learning' and 'MLE' are three keywords, " +
        "not one, because this list is matched against free text.",
    ),
});

export type ResumeMeta = z.infer<typeof resumeMetaSchema>;
