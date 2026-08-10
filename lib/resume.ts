/*
  Google Drive share links don't download.

  What you get from Drive's "Copy link" is a preview page:
    https://drive.google.com/file/d/FILE_ID/view?usp=sharing
  Clicking that opens Drive's viewer, not the PDF. The `download` attribute
  can't help either — it's ignored cross-origin.

  The direct-download form is:
    https://drive.google.com/uc?export=download&id=FILE_ID

  So we extract the file id from whatever Anhat pastes and build both URLs. Any
  non-Drive URL passes through untouched, which keeps the field usable for a
  self-hosted PDF or a Dropbox link.
*/

export interface ResumeLinks {
  /** Opens in a viewer. Used by the chatbot, where a surprise download is hostile. */
  viewUrl: string;
  /** Forces a file download. Used by the explicit Resume buttons. */
  downloadUrl: string;
  isGoogleDrive: boolean;
}

/**
 * Pulls the file id out of every Drive URL shape people actually paste.
 * Ordered most- to least-specific; `/file/d/<id>/` must be tried before the
 * bare `id=` query, since a share link can contain both.
 */
function extractDriveId(url: string): string | null {
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]{10,})/, // .../file/d/<id>/view
    /\/document\/d\/([a-zA-Z0-9_-]{10,})/, // Google Docs
    /\/presentation\/d\/([a-zA-Z0-9_-]{10,})/,
    /\/spreadsheets\/d\/([a-zA-Z0-9_-]{10,})/,
    /[?&]id=([a-zA-Z0-9_-]{10,})/, // .../open?id=<id>, .../uc?id=<id>
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export function resumeLinks(rawUrl: string | undefined | null): ResumeLinks | null {
  const url = rawUrl?.trim();
  if (!url) return null;

  // Guard against a pasted value that isn't a URL at all — an invalid href in
  // the header is worse than no button.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;

  const isDriveHost = /(^|\.)(drive|docs)\.google\.com$/.test(parsed.hostname);
  const id = isDriveHost ? extractDriveId(url) : null;

  if (!id) {
    // Not Drive, or a Drive URL we couldn't parse — use it as-is for both.
    return { viewUrl: url, downloadUrl: url, isGoogleDrive: false };
  }

  return {
    viewUrl: `https://drive.google.com/file/d/${id}/view`,
    downloadUrl: `https://drive.google.com/uc?export=download&id=${id}`,
    isGoogleDrive: true,
  };
}
