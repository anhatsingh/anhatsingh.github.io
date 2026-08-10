import { notFound } from "next/navigation";
import { SectionEditor } from "@/components/admin/section-editor";
import { getTableSpec } from "@/lib/admin/schema";
import { getServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  const spec = getTableSpec(section);
  if (!spec) notFound();

  const db = getServiceClient();
  let rows: Record<string, unknown>[] = [];

  if (db) {
    const query = db.from(spec.table).select("*");
    const { data } = spec.singleton
      ? await query.limit(1)
      : await query.order("sort_order", { ascending: true });
    rows = data ?? [];
  }

  return (
    <div>
      <h2 className="font-display text-3xl">{spec.label}</h2>
      {!db && (
        <p className="mt-3 text-sm text-danger">
          SUPABASE_SERVICE_ROLE_KEY isn&apos;t set, so nothing can be loaded or saved.
        </p>
      )}
      <div className="mt-6">
        <SectionEditor spec={spec} rows={rows} />
      </div>
    </div>
  );
}
