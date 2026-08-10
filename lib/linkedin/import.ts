import JSZip from "jszip";
import Papa from "papaparse";

/*
  LINKEDIN EXPORT IMPORTER
  ========================
  This is the ONLY legitimate way to get work history out of LinkedIn.

  There is no API for it: Sign In with LinkedIn (OIDC) returns just name, photo
  and email; positions/education/skills sit behind partner-only scopes. Scraping
  breaches §8.2 of the User Agreement — LinkedIn won a $500k contract judgment
  against hiQ and shut Proxycurl down entirely in 2025. The DMA Member Data
  Portability API is real but EEA/Switzerland only.

  So: Settings → Data Privacy → "Get a copy of your data" → drop the ZIP here.

  Parsing runs in the BROWSER on purpose. A full archive is often several MB,
  comfortably past Vercel's serverless request body limit, and there's no reason
  to ship the whole thing to a server when we only want four CSVs.
*/

export interface ImportedExperience {
  slug: string;
  role: string;
  company: string;
  start_date: string;
  end_date: string | null;
  location: string | null;
  summary: string;
}

export interface ImportedEducation {
  slug: string;
  institution: string;
  degree: string;
  start_year: string | null;
  end_year: string | null;
  note: string | null;
}

export interface ImportedSkill {
  slug: string;
  name: string;
  category: string;
}

export interface ImportedCertification {
  slug: string;
  name: string;
  issuer: string;
  issue_date: string | null;
  credential_url: string | null;
  /** Long-form detail. Belongs in the page body, not squeezed into `issuer`. */
  description?: string;
}

export interface ImportedProject {
  slug: string;
  name: string;
  summary: string;
  description: string;
  repo_url: string | null;
  live_url: string | null;
  started: string | null;
  ended: string | null;
}

export interface ImportedTestimonial {
  slug: string;
  quote: string;
  author_name: string;
  author_title: string | null;
  author_company: string | null;
  received_at: string | null;
}

export interface ImportedVolunteering {
  slug: string;
  role: string;
  company: string;
  start_date: string;
  end_date: string | null;
  summary: string;
}

export interface ImportResult {
  headline?: string;
  summary?: string;
  experience: ImportedExperience[];
  education: ImportedEducation[];
  skills: ImportedSkill[];
  certifications: ImportedCertification[];
  projects: ImportedProject[];
  testimonials: ImportedTestimonial[];
  volunteering: ImportedVolunteering[];
  /** Files present in the archive that this parser deliberately ignores. */
  skipped: Array<{ file: string; rows: number; why: string }>;
  /** Files we looked for but didn't find — surfaced so a partial export is obvious. */
  missing: string[];
}

export function slugify(...parts: string[]): string {
  return parts
    .join("-")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** LinkedIn writes dates as "Mar 2024", "2024", or "". Normalise to YYYY-MM. */
export function normalizeDate(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const withMonth = trimmed.match(/^([A-Za-z]{3})[a-z]*\s+(\d{4})$/);
  if (withMonth) {
    const month = MONTHS[withMonth[1].toLowerCase()];
    if (month) return `${withMonth[2]}-${month}`;
  }

  const yearOnly = trimmed.match(/^(\d{4})$/);
  if (yearOnly) return yearOnly[1];

  /*
    Recommendations are stamped "06/25/24, 03:08 PM" — a different format from
    every other date in the archive. Two-digit years are read as 20xx, which is
    safe here: LinkedIn launched in 2003 and the field didn't exist before that.
  */
  // 4-digit branch first: alternation is ordered, and \d{2} would match
  // the "20" of "2023" and read the year as 2020.
  const slashed = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?!\d)/);
  if (slashed) {
    const month = Number(slashed[1]);
    const rawYear = slashed[3];
    const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
    if (month >= 1 && month <= 12) return `${year}-${String(month).padStart(2, "0")}`;
  }

  return trimmed;
}

function parseCsv<T>(text: string): T[] {
  const result = Papa.parse<T>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  return result.data.filter((row) => row && Object.keys(row).length > 0);
}

/**
 * Finds a CSV by name regardless of the folder LinkedIn nests it under, which
 * varies between "Basic" and "Complete" exports.
 */
function findFile(zip: JSZip, filename: string) {
  const target = filename.toLowerCase();
  for (const path of Object.keys(zip.files)) {
    const base = path.split("/").pop()?.toLowerCase();
    if (base === target && !zip.files[path].dir) return zip.files[path];
  }
  return null;
}

export async function parseLinkedInExport(file: File | Blob): Promise<ImportResult> {
  const zip = await JSZip.loadAsync(file);
  const missing: string[] = [];

  async function read(name: string): Promise<string | null> {
    const entry = findFile(zip, name);
    if (!entry) {
      missing.push(name);
      return null;
    }
    return entry.async("string");
  }

  const result: ImportResult = {
    experience: [],
    education: [],
    skills: [],
    certifications: [],
    projects: [],
    testimonials: [],
    volunteering: [],
    skipped: [],
    missing,
  };

  const profileCsv = await read("Profile.csv");
  if (profileCsv) {
    const rows = parseCsv<Record<string, string>>(profileCsv);
    const p = rows[0];
    if (p) {
      result.headline = p["Headline"]?.trim() || undefined;
      result.summary = p["Summary"]?.trim() || undefined;
    }
  }

  const positionsCsv = await read("Positions.csv");
  if (positionsCsv) {
    for (const row of parseCsv<Record<string, string>>(positionsCsv)) {
      const company = row["Company Name"]?.trim();
      const title = row["Title"]?.trim();
      if (!company || !title) continue;

      result.experience.push({
        slug: slugify(title, company),
        role: title,
        company,
        start_date: normalizeDate(row["Started On"]) ?? "",
        end_date: normalizeDate(row["Finished On"]),
        location: row["Location"]?.trim() || null,
        summary: row["Description"]?.trim() ?? "",
      });
    }
  }

  const educationCsv = await read("Education.csv");
  if (educationCsv) {
    for (const row of parseCsv<Record<string, string>>(educationCsv)) {
      const school = row["School Name"]?.trim();
      if (!school) continue;

      const degree = row["Degree Name"]?.trim() || "Studied";
      result.education.push({
        slug: slugify(degree, school),
        institution: school,
        degree,
        // Education dates are year-granular on LinkedIn; keep just the year.
        start_year: normalizeDate(row["Start Date"])?.slice(0, 4) ?? null,
        end_year: normalizeDate(row["End Date"])?.slice(0, 4) ?? null,
        note: row["Notes"]?.trim() || null,
      });
    }
  }

  const skillsCsv = await read("Skills.csv");
  if (skillsCsv) {
    const seen = new Set<string>();
    for (const row of parseCsv<Record<string, string>>(skillsCsv)) {
      const name = row["Name"]?.trim();
      if (!name) continue;
      const slug = slugify(name);
      if (seen.has(slug)) continue;
      seen.add(slug);
      // LinkedIn has no category concept; everything lands in one bucket for
      // Anhat to re-file. Guessing categories here would just be wrong quietly.
      result.skills.push({ slug, name, category: "Imported" });
    }
  }

  const certsCsv = await read("Certifications.csv");
  if (certsCsv) {
    for (const row of parseCsv<Record<string, string>>(certsCsv)) {
      const name = row["Name"]?.trim();
      if (!name) continue;
      result.certifications.push({
        slug: slugify(name),
        name,
        issuer: row["Authority"]?.trim() || "—",
        issue_date: normalizeDate(row["Started On"]),
        credential_url: row["Url"]?.trim() || null,
      });
    }
  }

  /*
    Projects. The biggest omission in the original importer — a Basic export
    carries them, and they're the section a recruiter reads after experience.
  */
  const projectsCsv = await read("Projects.csv");
  if (projectsCsv) {
    for (const row of parseCsv<Record<string, string>>(projectsCsv)) {
      const title = row["Title"]?.trim();
      if (!title) continue;

      const url = row["Url"]?.trim() || null;
      const description = row["Description"]?.trim() ?? "";
      const isRepo = url ? /^https?:\/\/(www\.)?github\.com\//i.test(url) : false;

      result.projects.push({
        slug: slugify(title),
        name: title,
        // First sentence as the card line; the rest stays in description.
        summary: description.split(/(?<=[.!?])\s/)[0]?.slice(0, 200) ?? "",
        description,
        repo_url: isRepo ? url : null,
        live_url: url && !isRepo ? url : null,
        started: normalizeDate(row["Started On"]),
        ended: normalizeDate(row["Finished On"]),
      });
    }
  }

  /*
    Recommendations. Only VISIBLE ones — a PENDING recommendation hasn't been
    accepted on LinkedIn and isn't shown there, so publishing it here would put
    words in someone's mouth they haven't agreed to display.
  */
  const recsCsv = await read("Recommendations_Received.csv");
  if (recsCsv) {
    let hidden = 0;
    for (const row of parseCsv<Record<string, string>>(recsCsv)) {
      const text = row["Text"]?.trim();
      const first = row["First Name"]?.trim() ?? "";
      const last = row["Last Name"]?.trim() ?? "";
      if (!text || !(first || last)) continue;

      if ((row["Status"] ?? "").trim().toUpperCase() !== "VISIBLE") {
        hidden++;
        continue;
      }

      const name = `${first} ${last}`.trim();
      result.testimonials.push({
        slug: slugify(name),
        quote: text,
        author_name: name,
        author_title: row["Job Title"]?.trim() || null,
        author_company: row["Company"]?.trim() || null,
        received_at: normalizeDate(row["Creation Date"]),
      });
    }
    if (hidden) {
      result.skipped.push({
        file: "Recommendations_Received.csv",
        rows: hidden,
        why: "not VISIBLE on LinkedIn — accept it there first",
      });
    }
  }

  /* Honors and test scores both land in certifications — it's the section that
     already renders "things awarded by someone else". */
  const honorsCsv = await read("Honors.csv");
  if (honorsCsv) {
    for (const row of parseCsv<Record<string, string>>(honorsCsv)) {
      const title = row["Title"]?.trim();
      if (!title) continue;
      result.certifications.push({
        slug: slugify(title),
        name: title,
        // LinkedIn has no issuer field for honours, and putting the whole
        // description here renders a paragraph where a name belongs.
        issuer: "Honour",
        issue_date: normalizeDate(row["Issued On"]),
        credential_url: null,
        description: row["Description"]?.trim() || undefined,
      });
    }
  }

  const scoresCsv = await read("TestScores.csv");
  if (scoresCsv) {
    for (const row of parseCsv<Record<string, string>>(scoresCsv)) {
      const name = row["Name"]?.trim();
      if (!name) continue;
      const score = row["Score"]?.trim();
      result.certifications.push({
        slug: slugify(name),
        name: score ? `${name} — ${score}` : name,
        issuer: "Test score",
        issue_date: normalizeDate(row["Tested On"]),
        credential_url: null,
        description: row["Description"]?.trim() || undefined,
      });
    }
  }

  /*
    Volunteering maps onto experience because that's the only table shaped for
    a dated role at an organisation — but it is imported UNPUBLISHED. Dropping
    six society roles into a work timeline unannounced would misrepresent it.
  */
  const volCsv = await read("Volunteering.csv");
  if (volCsv) {
    for (const row of parseCsv<Record<string, string>>(volCsv)) {
      const role = row["Role"]?.trim();
      const company = row["Company Name"]?.trim();
      if (!role || !company) continue;
      result.volunteering.push({
        slug: slugify(role, company),
        role,
        company,
        start_date: normalizeDate(row["Started On"]) ?? "",
        end_date: normalizeDate(row["Finished On"]),
        summary: row["Description"]?.trim() ?? "",
      });
    }
  }

  // Seen and deliberately left alone, reported so it's a choice not an oversight.
  for (const [file, why] of [
    ["Courses.csv", "university course codes — too granular for a portfolio"],
    ["Rich_Media.csv", "attachments from LinkedIn posts, not articles"],
    ["SavedJobAlerts.csv", "not portfolio content"],
    ["Learning.csv", "LinkedIn Learning history, not credentials"],
  ] as Array<[string, string]>) {
    const raw = findFile(zip, file);
    if (!raw) continue;
    const text = await raw.async("string");
    result.skipped.push({ file, rows: Math.max(0, parseCsv(text).length), why });
  }

  return result;
}
