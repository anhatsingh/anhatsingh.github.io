import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin",
  // The admin surface must never end up in search results.
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-bg text-text">{children}</div>;
}
