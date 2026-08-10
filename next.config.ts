import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next 16 writes AGENTS.md / CLAUDE.md into the repo root on every `next dev`.
  // Turned off so they aren't recreated after being removed.
  agentRules: false,

  // Writing entries and projects can point at arbitrary cover images (Medium,
  // Unsplash, GitHub avatars). Rather than maintain a hostname allowlist that
  // breaks every time Anhat adds a post, we let next/image optimize any HTTPS
  // source. The URLs are admin-authored, not user-submitted.
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
};

export default nextConfig;
