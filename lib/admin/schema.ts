/*
  ADMIN FIELD SCHEMA
  ==================
  Describes every editable table once, and both the forms and the write
  validation are generated from it. Adding a field means one line here, not a
  new form component plus a new validator that can drift from it.

  `table` doubles as the allowlist for mutations — a request naming anything not
  in ADMIN_TABLES is rejected outright, so the table name can come from a URL
  without becoming an injection surface.
*/

export type FieldType = "text" | "textarea" | "url" | "email" | "boolean" | "number" | "list";

export interface Field {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  help?: string;
  /** Rendered but not editable after creation. Slugs are the chatbot's addresses. */
  lockedAfterCreate?: boolean;
  /**
   * Renders a "Hide" checkbox beside this field. The value is the platform key;
   * checked keys are collected into the `hidden_socials` array rather than each
   * needing its own boolean column.
   */
  hideKey?: string;
  /** Shows an upload button that fills this field with a hosted image URL. */
  upload?: boolean;
}

export interface TableSpec {
  table: string;
  /** Route segment and nav label. */
  key: string;
  label: string;
  /** Singleton tables have exactly one row and no list view. */
  singleton?: boolean;
  /** Field used as the row heading in list views. */
  titleField: string;
  fields: Field[];
}

const SLUG_FIELD: Field = {
  name: "slug",
  label: "Slug",
  type: "text",
  required: true,
  lockedAfterCreate: true,
  help: "Stable id the chatbot uses to reference this item. Changing it breaks existing highlights.",
};

const ORDER_FIELD: Field = {
  name: "sort_order",
  label: "Sort order",
  type: "number",
  help: "Lower numbers appear first.",
};

const PUBLISHED_FIELD: Field = {
  name: "is_published",
  label: "Published",
  type: "boolean",
};

export const ADMIN_TABLES: TableSpec[] = [
  {
    table: "profile",
    key: "profile",
    label: "Profile",
    singleton: true,
    titleField: "name",
    fields: [
      { name: "name", label: "Name", type: "text", required: true },
      {
        name: "headline",
        label: "Headline",
        type: "text",
        required: true,
        help: "The big serif line in the hero.",
      },
      {
        name: "tagline",
        label: "Tagline",
        type: "text",
        required: true,
        help: "Small mono line above the headline. Also used as your job title in search results.",
      },
      { name: "bio", label: "Bio", type: "textarea", required: true },
      { name: "location", label: "Location", type: "text" },
      { name: "email", label: "Email", type: "email", required: true },
      {
        name: "avatar_url",
        upload: true,
        label: "Photo URL",
        type: "url",
        help: "Shown in About and as the chatbot's avatar. Portrait crops best.",
      },
      {
        name: "resume_url",
        label: "Resume URL",
        type: "url",
        help: "Google Drive share link. Make sure it's set to 'anyone with the link'.",
      },
      { name: "open_to_work", label: "Open to work", type: "boolean" },
      {
        name: "github_username",
        label: "GitHub",
        type: "text",
        hideKey: "github",
        help: "Handle only. Also drives the GitHub stats section.",
      },
      {
        name: "leetcode_username",
        label: "LeetCode",
        type: "text",
        hideKey: "leetcode",
        help: "Handle only. Also drives the LeetCode section.",
      },
      { name: "linkedin_url", label: "LinkedIn", type: "url", hideKey: "linkedin", help: "Full profile URL." },
      { name: "x_url", label: "X", type: "url", hideKey: "x", help: "Full profile URL." },
      { name: "kaggle_url", label: "Kaggle", type: "url", hideKey: "kaggle" },
      { name: "huggingface_url", label: "Hugging Face", type: "url", hideKey: "huggingface" },
      { name: "hashnode_url", label: "Hashnode", type: "url", hideKey: "hashnode" },
      { name: "peerlist_url", label: "Peerlist", type: "url", hideKey: "peerlist" },
      { name: "medium_url", label: "Medium", type: "url", hideKey: "medium" },
      { name: "stackoverflow_url", label: "Stack Overflow", type: "url", hideKey: "stackoverflow" },
      { name: "devto_url", label: "dev.to", type: "url", hideKey: "devto" },
    ],
  },
  {
    table: "experience",
    key: "experience",
    label: "Experience",
    titleField: "role",
    fields: [
      SLUG_FIELD,
      { name: "role", label: "Role", type: "text", required: true },
      { name: "company", label: "Company", type: "text", required: true },
      { name: "company_url", label: "Company URL", type: "url" },
      {
        name: "logo_url",
        upload: true,
        label: "Company logo URL",
        type: "url",
        help: "Optional. Square-ish works best. Leave blank for a monogram.",
      },
      { name: "start_date", label: "Start", type: "text", required: true, help: "YYYY-MM" },
      { name: "end_date", label: "End", type: "text", help: "YYYY-MM, or blank for present." },
      { name: "location", label: "Location", type: "text" },
      { name: "summary", label: "Summary", type: "textarea" },
      { name: "highlights", label: "Highlights", type: "list", help: "One per line." },
      { name: "tech", label: "Tech", type: "list", help: "One per line." },
      ORDER_FIELD,
      PUBLISHED_FIELD,
    ],
  },
  {
    table: "projects",
    key: "projects",
    label: "Projects",
    titleField: "name",
    fields: [
      SLUG_FIELD,
      { name: "name", label: "Name", type: "text", required: true },
      { name: "summary", label: "One-liner", type: "text" },
      { name: "description", label: "Description", type: "textarea" },
      { name: "tech", label: "Tech", type: "list", help: "One per line." },
      { name: "repo_url", label: "Repo URL", type: "url" },
      { name: "live_url", label: "Live URL", type: "url" },
      { name: "image_url", label: "Image", type: "url", upload: true },
      { name: "featured", label: "Featured", type: "boolean" },
      ORDER_FIELD,
      PUBLISHED_FIELD,
    ],
  },
  {
    table: "skills",
    key: "skills",
    label: "Skills",
    titleField: "name",
    fields: [
      SLUG_FIELD,
      { name: "name", label: "Name", type: "text", required: true },
      { name: "category", label: "Category", type: "text", help: "Groups the badges." },
      ORDER_FIELD,
      PUBLISHED_FIELD,
    ],
  },
  {
    table: "education",
    key: "education",
    label: "Education",
    titleField: "institution",
    fields: [
      SLUG_FIELD,
      { name: "institution", label: "Institution", type: "text", required: true },
      { name: "degree", label: "Degree", type: "text", required: true },
      { name: "field", label: "Field", type: "text" },
      { name: "start_year", label: "Start year", type: "text" },
      { name: "end_year", label: "End year", type: "text" },
      { name: "note", label: "Note", type: "textarea" },
      {
        name: "logo_url",
        upload: true,
        label: "Institution logo URL",
        type: "url",
        help: "Optional. Square-ish works best. Leave blank for a monogram.",
      },
      ORDER_FIELD,
      PUBLISHED_FIELD,
    ],
  },
  {
    table: "certifications",
    key: "certifications",
    label: "Certifications",
    titleField: "name",
    fields: [
      SLUG_FIELD,
      { name: "name", label: "Name", type: "text", required: true },
      { name: "issuer", label: "Issuer", type: "text", required: true },
      { name: "issue_date", label: "Issued", type: "text" },
      { name: "credential_url", label: "Credential URL", type: "url" },
      {
        name: "logo_url",
        upload: true,
        label: "Issuer logo URL",
        type: "url",
        help: "Optional. Square-ish works best. Leave blank for a monogram.",
      },
      ORDER_FIELD,
      PUBLISHED_FIELD,
    ],
  },
  {
    table: "testimonials",
    key: "testimonials",
    label: "Testimonials",
    titleField: "author_name",
    fields: [
      SLUG_FIELD,
      { name: "quote", label: "Quote", type: "textarea", required: true },
      { name: "author_name", label: "Author", type: "text", required: true },
      { name: "author_title", label: "Their title", type: "text" },
      { name: "author_company", label: "Their company", type: "text" },
      { name: "author_url", label: "Their profile URL", type: "url" },
      ORDER_FIELD,
      PUBLISHED_FIELD,
    ],
  },
  {
    table: "writing",
    key: "writing",
    label: "Writing",
    titleField: "title",
    fields: [
      SLUG_FIELD,
      { name: "title", label: "Title", type: "text", required: true },
      { name: "summary", label: "Summary", type: "textarea" },
      { name: "image_url", label: "Cover image", type: "url", upload: true },
      {
        name: "external_url",
        label: "Post URL",
        type: "url",
        required: true,
        help: "Where the post actually lives — Medium, Substack, etc.",
      },
      { name: "published_at", label: "Published", type: "text" },
      { name: "source", label: "Source", type: "text", help: "e.g. Medium" },
      ORDER_FIELD,
      PUBLISHED_FIELD,
    ],
  },
];

export function getTableSpec(key: string): TableSpec | undefined {
  return ADMIN_TABLES.find((t) => t.key === key);
}

/**
 * Coerces raw form values into the shapes Postgres expects, driven by the field
 * types above. Anything not declared as a field is dropped — that's what stops
 * a crafted form post from writing to columns the UI doesn't expose.
 */
export function coerceRow(spec: TableSpec, form: FormData): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  for (const field of spec.fields) {
    const raw = form.get(field.name);

    switch (field.type) {
      case "boolean":
        row[field.name] = form.get(field.name) === "on";
        break;
      case "number": {
        const n = Number(raw ?? 0);
        row[field.name] = Number.isFinite(n) ? n : 0;
        break;
      }
      case "list":
        row[field.name] = String(raw ?? "")
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      default: {
        // Empty text becomes "", never null.
        //
        // Several columns are `text not null default ''` (tagline, summary,
        // description, category…). Sending null for a blank optional field
        // violated the constraint and the save failed. "" satisfies it and is
        // equally falsy, so every `field ? render() : null` check in the UI
        // behaves identically either way.
        row[field.name] = String(raw ?? "").trim();
      }
    }
  }

  // Hide toggles aren't columns of their own — they collapse into one array,
  // so adding a platform doesn't mean adding a boolean column alongside it.
  const toggles = spec.fields.filter((f) => f.hideKey);
  if (toggles.length) {
    row.hidden_socials = toggles
      .filter((f) => form.get(`hidden__${f.hideKey}`) === "on")
      .map((f) => f.hideKey as string);
  }

  return row;
}
