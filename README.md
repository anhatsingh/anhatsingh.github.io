# anhatsingh.com

Portfolio site whose chatbot **drives the page**. Ask it something and it scrolls
to the relevant section, splits the layout, and pins callouts onto the exact
entries that answer you.

Next.js 16 · React 19 · Tailwind 4 · Vercel AI SDK · Supabase · OpenAI

---

## Quick start

```bash
npm install
npm run dev          # works with zero config — renders from seed content
```

Nothing is required to see the site. Each feature switches itself on when its
key appears, and says so plainly when it's missing.

```bash
npm run verify       # tool-layer + LinkedIn parser checks, no API key needed
npm run typecheck
npm run build
```

---

## Setup

Copy `.env.example` → `.env.local`, then work through as much as you need.

### 1. Chatbot — `OPENAI_API_KEY`

The only genuinely load-bearing key. Without it the chat returns a friendly 503
and the rest of the site is unaffected.

`OPENAI_MODEL` defaults to `gpt-4o-mini`. **Check OpenAI's current model list
before deploying** — their cheap tool-calling tier gets renamed periodically,
and a retired id means a dead chatbot.

### 2. Content + admin — Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Paste `lib/db/schema.sql` into the SQL editor and run it. It's idempotent.
3. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`.
4. Set `ADMIN_EMAILS` to your email. **An empty value locks everyone out** —
   that's deliberate, so a partially-configured deploy can't become an open door.
5. Visit `/admin`, sign in by magic link.

Until Supabase is configured the site serves `lib/content/seed.ts`. Replace that
placeholder content from `/admin` — experience, projects and testimonials are all
invented.

### 3. GitHub stats — `GH_STATS_PAT`

A classic PAT with **no scopes** is enough for public data. Add `read:user` if you
want private contributions counted in the "+N private" figure.

The contribution calendar exists only in GitHub's GraphQL API, and GraphQL rejects
unauthenticated requests outright — which is why a token is unavoidable here even
though the data is public. Cached for an hour, so this costs ~24 of 5,000 hourly
rate-limit points per day.

The section hides itself entirely if the token is absent or GitHub is down.

### 4. Contact — Resend

`RESEND_API_KEY` + `CONTACT_EMAIL`. Messages persist to Supabase *before* the email
is attempted, so a Resend outage never loses one. Without Resend, messages still
land in the database and show up in the admin inbox.

---

## Deploying

1. Import the repo on [Vercel](https://vercel.com), add the env vars above.
2. Point `anhatsingh.com` at Vercel: at your registrar, replace the GitHub Pages
   A-records with `76.76.21.21`, or a CNAME to `cname.vercel-dns.com`.
3. Disable GitHub Pages for this repo so it stops claiming the domain.

The pre-2026 site is preserved on the **`archive/2021-site`** branch.

---

## How the chatbot drives the page

```
model tool call ──▶ /api/chat validates args against real content ids
                          │
                          ▼
              ChatProvider reads tool output from the stream
                          │
                          ▼
              UIControlProvider (the action bus)
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
   scroll + focus    pin callouts     split layout
```

Five tools: `focusSection`, `highlightItems`, `clearFocus`, `openResume`,
`draftContactMessage`.

Two design decisions worth knowing before you change anything here:

**Content ids are validated server-side.** Tools are built per request, closed
over the real portfolio (`lib/chat/tools.ts`). A hallucinated
`experience:google` is rejected before it reaches the browser, and the model is
handed the valid vocabulary so its retry succeeds. Without this, one bad id pins
a callout onto nothing and the feature looks broken.

**The model cannot send email.** `draftContactMessage` only renders a card;
sending is a separate `POST /api/contact` triggered by a human click. There is no
send tool, so no amount of prompt injection produces a message in the inbox.

**Slugs are addresses.** Every content row's `slug` is what the chatbot names in
tool calls. Renaming one breaks the link between an answer and the thing on
screen, which is why admin locks the field after creation.

Sections don't know the chatbot exists — they register an id and subscribe to
"am I highlighted?". All sequencing, cooldowns and scrolling live in
`components/ui-control.tsx`.

---

## LinkedIn

There is no automatic sync, and this isn't an oversight.

The only self-serve LinkedIn API (Sign In with OpenID Connect) returns name,
photo and email — no positions, education or skills. Those sit behind
partner-only scopes requiring a company and a commercial agreement. Scraping
breaches §8.2 of the User Agreement: LinkedIn took a $500k contract judgment
against hiQ and shut Proxycurl down permanently in July 2025. The one legitimate
programmatic route, Member Data Portability, is EEA/Switzerland only.

So `/admin/import` takes the official export instead — LinkedIn → Settings &
Privacy → Get a copy of your data. The ZIP is parsed **in your browser** (archives
routinely exceed serverless body limits), previewed, and upserted on `slug` so
re-importing updates rows rather than duplicating them.

---

## Cost

Portfolio context is ~1.4k tokens, replies capped at 500. With per-IP rate
limiting, a daily global ceiling, and no tool that can spend money, expect a few
cents a month.

---

## Layout

```
app/
  page.tsx              server component — content + GitHub stats
  api/chat              streaming + tools
  api/contact           the only path to the inbox
  admin/(protected)     auth-guarded CRUD, schema-driven
lib/
  chat/                 tools, prompt, context seam, guards
  content/              types, seed, Supabase reads
  github/               GraphQL queries + normalisation
  linkedin/             export ZIP parser
components/
  ui-control.tsx        the action bus
  chat/                 provider, dock, contact card
  sections/             one per page section
scripts/                verification, no API key required
```

`lib/chat/context.ts` exposes a `ContextProvider` interface. Today it serialises
the whole portfolio, which at this size is cheaper and more accurate than
retrieval. If the content ever outgrows one prompt, swap in a pgvector
implementation — nothing outside that file changes.
