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
}

export interface ImportResult {
  headline?: string;
  summary?: string;
  experience: ImportedExperience[];
  education: ImportedEducation[];
  skills: ImportedSkill[];
  certifications: ImportedCertification[];
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

  return result;
}
