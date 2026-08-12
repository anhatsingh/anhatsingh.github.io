import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/seo/json-ld";
import { getPortfolio } from "@/lib/content";
import { SITE_URL, absoluteUrl } from "@/lib/seo";

/*
  The case study.

  Most candidates claim they shipped an LLM feature. The gap between that and
  being hired is showing the judgment — what could go wrong, and what you did
  about it. So this page is organised around decisions rather than features:
  every section names something that could have gone wrong, and what stops it.

  Keep it honest as the site changes. A working note that describes a system
  which no longer exists is worse than no working note — the claim it makes
  about its author is the opposite of the one intended.

  It's also a real page for SEO: TechArticle structured data, its own canonical,
  and it targets queries ("LLM tool calling UI", "portfolio chatbot RAG") that
  the homepage never will.
*/

export const metadata: Metadata = {
  title: "How the chatbot drives this page",
  description:
    "A working note on an assistant that drives a portfolio: validated tool calls, LaTeX résumés generated per job, retrieval that degrades safely, and the capabilities left out on purpose.",
  alternates: { canonical: absoluteUrl("/how-it-works") },
  openGraph: {
    type: "article",
    url: absoluteUrl("/how-it-works"),
    title: "How the chatbot drives this page",
    description:
      "Validated tool calls, per-job LaTeX résumés, retrieval that degrades safely, and the capabilities left out on purpose.",
  },
};

function Section({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-hairline pt-8">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">{n}</p>
      <h2 className="mt-2 font-display text-2xl md:text-3xl">{title}</h2>
      <div className="mt-4 space-y-4 leading-relaxed text-muted">{children}</div>
    </section>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-[var(--radius)] border border-hairline bg-surface p-4 font-mono text-xs leading-relaxed text-text">
      {children}
    </pre>
  );
}

export default async function HowItWorksPage() {
  const { profile } = await getPortfolio();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: "How the chatbot drives this page",
    description:
      "Validated tool calls, per-job LaTeX résumés, retrieval that degrades safely, and the capabilities left out on purpose.",
    url: absoluteUrl("/how-it-works"),
    author: { "@id": `${SITE_URL}/#person` },
    mainEntityOfPage: absoluteUrl("/how-it-works"),
    proficiencyLevel: "Expert",
  };

  return (
    <>
      <JsonLd data={jsonLd} />

      <main className="mx-auto max-w-2xl px-6 py-16 md:py-24">
        <Link
          href="/"
          className="font-mono text-xs uppercase tracking-widest text-muted hover:text-accent"
        >
          ← back to the site
        </Link>

        <header className="mt-8">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">
            /// Working note
          </p>
          <h1 className="mt-3 font-display text-4xl leading-[1.1] md:text-5xl">
            How the chatbot drives this page
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-muted">
            The assistant on this site doesn&apos;t just answer — it scrolls the page, pins
            callouts onto the entries that answer you, walks you through the whole thing on
            request, searches the web when the question needs it, and typesets a résumé for a job
            description you paste in. Twelve tools, and about twenty thousand lines around them.
            The interesting part isn&apos;t any of the features; it&apos;s what each one could do
            wrong, and what stops it.
          </p>
        </header>

        <div className="mt-14 space-y-12">
          <Section n="01" title="A hallucinated ID is the whole ballgame">
            <p>
              The model doesn&apos;t manipulate the DOM. It names things:{" "}
              <code className="text-accent">experience:ml-engineer-acme</code>. Something has to
              turn that name into a scroll position and a highlight.
            </p>
            <p>
              Models invent plausible identifiers. Ask about Kubernetes and you&apos;ll get{" "}
              <code className="text-accent">experience:google</code> — confident, well-formed, and
              pointing at nothing. The callout attaches to empty space and the feature looks broken
              rather than wrong.
            </p>
            <p>
              So the twelve tools are constructed{" "}
              <strong className="text-text">per request</strong>, closed over the content that
              actually exists. Validation happens before anything reaches the browser:
            </p>
            <Code>{`const accepted = items.filter((i) => known.has(i.itemId));

if (!accepted.length) {
  return {
    ok: false,
    error: \`None of those ids exist: \${rejected.join(", ")}.
            Valid ids are: \${[...known.keys()].join(", ")}\`,
  };
}`}</Code>
            <p>
              The error hands back the valid vocabulary. That matters more than the rejection: a
              bare failure gets retried identically, while a failure carrying the answer gets
              retried correctly. A mixed batch keeps the real IDs and drops the invented ones, so
              one bad guess doesn&apos;t cost the whole response.
            </p>
            <p>
              The right handling differs by tool, and that&apos;s a judgment rather than a rule.
              A highlight with no valid target is worth rejecting so the model can try again. A
              seven-stop tour with one bad callout is worth keeping — the walk is worth more than
              the callout, and the stop still lands on the right section.
            </p>
          </Section>

          <Section n="02" title="The model cannot send email — by construction">
            <p>
              This site has a contact form the assistant can fill in. The obvious implementation is
              a <code className="text-accent">sendEmail</code> tool, and it&apos;s a mistake.
            </p>
            <p>
              Anything a visitor types reaches the model, and since it can search the web, so does
              anything on a page it reads. Prompt injection against a bot that can only talk is
              embarrassing. Against a bot that can send mail, it&apos;s an open relay pointed at
              your own inbox — and no amount of instruction-hardening turns that into a guarantee,
              because instructions are exactly what an injection attacks.
            </p>
            <p>
              So the capability doesn&apos;t exist. The model can call{" "}
              <code className="text-accent">draftContactMessage</code>, which renders an editable
              card. Sending is an ordinary HTTP request the browser makes after a human clicks
              Send. There is no tool to abuse, so the guarantee doesn&apos;t depend on the prompt
              holding.
            </p>
            <p className="text-text">
              The general form: when a capability is dangerous, removing it beats defending it. A
              test asserts no tool matching <code className="text-accent">/send|email|mail/</code>{" "}
              exists, so re-introducing one fails CI.
            </p>
          </Section>

          <Section n="03" title="Agency without motion sickness">
            <p>
              A model that moves the page on every turn is exhausting. One that never moves it is
              pointless. The line between them is sequencing.
            </p>
            <p>
              Navigations are <strong className="text-text">queued, never dropped</strong>, with a
              1.2-second floor between them. Dropping one produces an answer referencing something
              the page never moved to — worse than a slow tour. Highlights cap at three and{" "}
              <em>replace</em> rather than accumulate, so three questions don&apos;t leave the page
              covered in stale callouts.
            </p>
            <p>
              That floor has teeth. A stop that focused a section, pinned a callout and then
              scrolled to the chart inside it spent two full cooldowns arriving — so landing on
              something within a section became an argument to the scroll rather than a second
              call, and a step with nothing to pin skips the queue entirely. A queued no-op still
              costs 1.2 seconds.
            </p>
            <p>
              Every action shows as a pill in the transcript —{" "}
              <code className="text-accent">↳ focused Experience · highlighted 2 roles</code> — and
              each is clickable, because the record of an action is also the way back to it.
            </p>
            <p>
              Accessibility isn&apos;t a coat of paint here. Scrolling a viewport leaves a keyboard
              user exactly where they were, so navigation moves real focus to the section heading
              and announces through an <code className="text-accent">aria-live</code> region.{" "}
              <code className="text-accent">prefers-reduced-motion</code> swaps smooth scroll for
              instant jumps.
            </p>
          </Section>

          <Section n="04" title="The tour: planning is the model's job, pacing is yours">
            <p>
              Ask to be shown around and the assistant walks you through Experience, Education,
              Skills, Projects, a summary, the timeline chart, and how to get in touch.
            </p>
            <p>
              The first version ran the whole thing inside one reply — seven sections scrolled past
              in a couple of seconds, each highlight replaced by the next before anyone could read
              it. Correct, and useless. The fix wasn&apos;t slower scrolling; it was giving the
              wheel to the reader.
            </p>
            <p>
              So the route arrives in <strong className="text-text">one tool call</strong> and the
              browser owns everything after that. Previous and Next name where they go rather than
              saying &quot;next&quot;. Auto-play runs by default with a visible countdown, and
              stops the instant a button is pressed. A round trip to the model per stop would have
              made every press cost a wait, with the answer arriving somewhere below the fold.
            </p>
            <p>
              It is also the most expensive reply the site produces — seven stops of narration in a
              single tool call, well past the 500-token ceiling that suits ordinary prose. It gets
              its own ceiling, and then gets cached, because the prompt fixes the route: the reply
              genuinely doesn&apos;t depend on the conversation. That property is the entire reason
              it&apos;s safe to cache, and the reason nothing else is.
            </p>
          </Section>

          <Section n="05" title="A résumé written for one job, in real LaTeX">
            <p>
              Paste a job description and you get a PDF typeset from the same template the printed
              CV uses. The pipeline is five stages, and the interesting decision is where the model
              is allowed to touch.
            </p>
            <Code>{`job description
  → structured extraction   (typed object, never LaTeX)
  → render                  (owns every backslash)
  → pdflatex, twice         (page count settles on pass two)
  → deterministic ATS audit (read the text layer back)
  → the model confirms fidelity`}</Code>
            <p>
              The model never writes markup. One unbalanced brace from a language model is an
              unrecoverable compile failure, and model-authored LaTeX can reach{" "}
              <code className="text-accent">\input</code> and{" "}
              <code className="text-accent">\write18</code>. So it fills in a typed object and the
              renderer owns escaping. Even emphasis is data: the model names the phrase it wants
              bolded, and a phrase that isn&apos;t a verbatim substring is dropped rather than
              guessed at.
            </p>
            <p>
              Then the PDF is read back and compared to the object it came from — because a résumé
              can compile perfectly and still be broken for its only real reader, a parser reading
              the text layer. Those failures are silent: a bullet that didn&apos;t make it, a date
              format that parses badly, an escape printed literally. Deterministic checks run
              first, since they&apos;re cheap and never disagree with themselves. The model&apos;s
              judgment is reserved for what can&apos;t be checked mechanically.
            </p>
            <p>
              One finding from doing this: <code className="text-accent">\scshape</code> made
              section headings extract as <code className="text-accent">S UMMARY</code>. It looked
              perfect and parsed wrong, which is exactly the class of bug the audit exists for.
            </p>
          </Section>

          <Section n="06" title="Retrieval, with the summaries always in the prompt">
            <p>
              A portfolio is small. Serialised whole — every role, project and skill, plus live
              GitHub and LeetCode figures — it&apos;s a couple of thousand tokens, so the summaries
              go in the prompt unconditionally.
            </p>
            <p>
              The bodies don&apos;t fit, and that&apos;s what pgvector is for: chunks are embedded
              on save and the question retrieves the handful that matter. The layering is the
              point. Retrieval <em>adds</em> depth rather than being the only path to the content,
              so a missing extension, a cold cache or an embedding outage costs detail rather than
              producing an assistant that has forgotten who it works for.
            </p>
            <p className="text-text">
              Knowing which half of your content needs RAG is more useful than knowing how to build
              it.
            </p>
          </Section>

          <Section n="07" title="Web search, and treating results as hostile">
            <p>
              Ask what dbt is, or what a company in the history builds, and the assistant searches
              rather than guessing. Two guardrails matter more than the integration.
            </p>
            <p>
              First: it will not search for the subject of this site. Results for a common name are
              other people, and a public answer can&apos;t tell them apart — everything about him
              is already in context, so the tool refuses before it checks whether search is even
              configured.
            </p>
            <p>
              Second: retrieved text is fenced as untrusted. A search result is a page a stranger
              wrote, and it lands in the same context window as the instructions. The visitor gets
              the citations, the model gets the content, and the budget is per-IP so one visitor
              can&apos;t drain a metered quota.
            </p>
          </Section>

          <Section n="08" title="The admin is Postgres policies, not a login page">
            <p>
              Every table on this site is editable from a private dashboard behind Supabase auth,
              gated on an allow-list of email addresses. But the login isn&apos;t what protects the
              data — row-level security is, and the valuable part of it is negative space.
            </p>
            <p>
              With RLS on, <strong className="text-text">absence of a policy means denial</strong>.
              Published rows are world-readable; unpublished drafts aren&apos;t. And a few tables
              have no visitor policy at all — the job descriptions behind saved résumés, which
              reveal where he&apos;s applying, sit in a table that simply has no read policy beside
              the résumés it&apos;s about.
            </p>
            <p>
              That absence is invisible to anyone reading the schema quickly, and one well-meaning
              &quot;add a read policy to everything&quot; loop would undo it silently. So the
              schema is applied to a real Postgres in CI and the missing policies are asserted as
              tests. The negative properties are the ones worth testing.
            </p>
          </Section>

          <Section n="09" title="Sending a conversation on">
            <p>
              A recruiter who works out that someone fits usually has to convince a hiring manager
              next, and until recently the transcript died with the tab.
            </p>
            <p>
              Share stores it and hands back a link. Three decisions carry it: sharing is explicit
              and per-conversation, so nothing is written until a button is pressed; the stored copy
              holds only what was said, with no IP, session or identifier, which is why the feature
              needs no consent flow; and the page is <code className="text-accent">noindex</code>{" "}
              and disallowed in <code className="text-accent">robots.txt</code>, because these are
              somebody&apos;s questions rather than content this site publishes.
            </p>
            <p>
              The table has a read policy and deliberately no insert policy. A link works precisely
              because whoever holds the id can read it — but writes go through the service role
              after a click, so a link can&apos;t be forged into existence.
            </p>
          </Section>

          <Section n="10" title="Testing an LLM feature without an LLM">
            <p>
              Every property above is verified without an API key. Tools are pure functions of
              content and arguments, so the tests hand them fabricated IDs and assert the
              rejection, hand them a mixed batch and assert the partial accept, and assert no
              send-shaped tool exists.
            </p>
            <p>
              Just under 700 checks run in a few seconds, covering the tool layer, theme-token
              parity, contrast in both modes, structured data, the LaTeX escaper, the schema
              against a real Postgres, and the client/server boundary — that last one after a
              helper living in a{" "}
              <code className="text-accent">&quot;use client&quot;</code> module was called from
              the server, which compiles, type-checks and builds clean before failing on every
              request.
            </p>
            <p>
              What they can&apos;t test is whether the model chooses to call the right tool —
              that&apos;s a judgment, and judgments need evals rather than assertions.
            </p>
          </Section>
        </div>

        <footer className="mt-16 border-t border-hairline pt-8">
          <p className="text-muted">
            Next.js and the Vercel AI SDK, Supabase for Postgres and pgvector, OpenAI for tool
            calling and embeddings, Tavily for search, and a container on Cloud Run that does
            nothing but run pdflatex. The source is{" "}
            <a
              href="https://github.com/anhatsingh/anhatsingh.github.io"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              on GitHub
            </a>
            .
          </p>
          <p className="mt-4">
            <Link href="/#hero" className="font-mono text-xs uppercase tracking-widest text-accent hover:underline">
              ⌁ go try it →
            </Link>
          </p>
          <p className="mt-6 font-mono text-xs text-muted">— {profile.name}</p>
        </footer>
      </main>
    </>
  );
}
