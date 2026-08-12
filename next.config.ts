import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {

    /*
      Server actions cap request bodies at 1MB by default, and image uploads go
      through one. Without this a 2MB file is rejected by the framework before
      lib/storage.ts ever sees it — and the error surfaces as a generic action
      failure rather than the size message we wrote. 3mb leaves headroom for the
      multipart encoding overhead on top of the 2MB file limit.
    */
    serverActions: { bodySizeLimit: "3mb" },
  },

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
