/*
  Number formatting, locale-pinned.

  These figures are rendered on the SERVER, so a bare toLocaleString() picks up
  the server's locale — not the visitor's. On a machine set to en-IN that turned
  1280076 into "12,80,076" (lakh grouping), which would then be served to every
  visitor regardless of where they are, and would differ between local dev and
  the deployment. Pinning en-US makes the output deterministic.
*/
export function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}
