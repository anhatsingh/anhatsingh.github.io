/*
  Crops the baked-in whitespace out of stored logo images.

  Why this is needed at all: a logo file is usually a wordmark centred in a
  square canvas. One of the ones in use here is 200x200 with only 200x60 of
  actual ink — 70px of white above and below, inside the image. No amount of
  CSS fixes that, because as far as the browser is concerned the image *is*
  square, so a plate that hugs its aspect ratio still hugs a square.

  So the margin comes off the file. Afterwards the image's real shape matches
  its ink, <LogoPlate> sizes itself from that, and the logo fills its plate.

  Uploads a new object rather than overwriting: the old URL may be cached by
  the CDN and by next/image, and replacing bytes at the same path would leave
  both serving the untrimmed version for a long time.

  Dry run by default:
    npx tsx scripts/trim-logos.ts
    npx tsx scripts/trim-logos.ts --apply
*/

import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import { checkSupabaseUrl } from "../lib/supabase/config";

loadEnvConfig(process.cwd(), true, { info: () => {}, error: () => {} });

const apply = process.argv.includes("--apply");

/** Tables holding a logo_url, and the column naming each row for the log. */
const TARGETS: Array<{ table: string; title: string }> = [
  { table: "experience", title: "company" },
  { table: "education", title: "institution" },
  { table: "certifications", title: "issuer" },
];

const BUCKET = "media";

async function main() {
  const { url, problem } = checkSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(problem ?? "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }

  const db = createClient(url, key, { auth: { persistSession: false } });
  let changed = 0;

  for (const target of TARGETS) {
    const { data, error } = await db.from(target.table).select("*");
    if (error) {
      console.error(`  ${target.table}: ${error.message}`);
      continue;
    }

    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const logo = row.logo_url as string | null;
      if (!logo) continue;

      const label = String(row[target.title] ?? row.slug);

      let input: Buffer;
      try {
        const res = await fetch(logo);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        input = Buffer.from(await res.arrayBuffer());
      } catch (err) {
        console.log(`  ! ${label}: couldn't fetch — ${(err as Error).message}`);
        continue;
      }

      const before = await sharp(input).metadata();

      /*
        Flatten onto white first: these are JPEGs on white, but a PNG with a
        transparent surround would otherwise trim to nothing useful. Threshold
        rather than exact match because JPEG compression leaves the "white"
        margin at 250-254 rather than pure 255.
      */
      let output: Buffer;
      try {
        output = await sharp(input)
          .flatten({ background: "#ffffff" })
          .trim({ background: "#ffffff", threshold: 12 })
          .png()
          .toBuffer();
      } catch (err) {
        console.log(`  ! ${label}: trim failed — ${(err as Error).message}`);
        continue;
      }

      const after = await sharp(output).metadata();
      const bw = before.width ?? 0;
      const bh = before.height ?? 0;
      const aw = after.width ?? 0;
      const ah = after.height ?? 0;

      if (!aw || !ah) {
        console.log(`  ! ${label}: trimmed to nothing, left alone`);
        continue;
      }

      // A couple of pixels off the edge isn't worth a new file and a cache miss.
      const shrank = (bw - aw) / (bw || 1) > 0.02 || (bh - ah) / (bh || 1) > 0.02;
      if (!shrank) {
        console.log(`  = ${label}: ${bw}x${bh} already tight`);
        continue;
      }

      console.log(`  + ${label}: ${bw}x${bh} → ${aw}x${ah}`);
      changed++;

      if (!apply) continue;

      const path = `logo-${String(row.slug)}-trimmed.png`;
      const { error: upErr } = await db.storage
        .from(BUCKET)
        .upload(path, output, { contentType: "image/png", upsert: true });
      if (upErr) {
        console.log(`  ! ${label}: upload failed — ${upErr.message}`);
        continue;
      }

      const { data: pub } = db.storage.from(BUCKET).getPublicUrl(path);
      const { error: dbErr } = await db
        .from(target.table)
        .update({ logo_url: pub.publicUrl })
        .eq("id", row.id as string);
      if (dbErr) console.log(`  ! ${label}: db update failed — ${dbErr.message}`);
    }
  }

  console.log(
    apply
      ? `\nTrimmed ${changed} logo(s).\n`
      : `\nDry run. ${changed} logo(s) would be trimmed. Re-run with --apply.\n`,
  );
}

main();
