import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/seo/json-ld";
import { getPortfolio } from "@/lib/content";
import { SITE_URL, absoluteUrl } from "@/lib/seo";

/*
  The case study.

  Most candidates claim they shipped an LLM feature. The gap between that and
  being hired is showing the judgment — what could go wrong, and what you did
  about it. So this page is organised around the three failure modes that
  actually mattered, not around a feature list.

  It's also a real page for SEO: TechArticle structured data, its own canonical,
  and it targets queries ("LLM tool calling UI", "portfolio chatbot RAG") that
  the homepage never will.
*/

export const metadata: Metadata = {
  title: "How the chatbot drives this page",
  description:
    "A working note on building an LLM that manipulates a UI through validated tool calls — the three failure modes that mattered, and what stops each one.",
  alternates: { canonical: absoluteUrl("/how-it-works") },
  openGraph: {
    type: "article",
    url: absoluteUrl("/how-it-works"),
    title: "How the chatbot drives this page",
    description:
      "Building an LLM that manipulates a UI through validated tool calls: hallucinated IDs, prompt injection, and motion sickness.",
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
      "Building an LLM that manipulates a UI through validated tool calls: hallucinated IDs, prompt injection, and motion sickness.",
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
            The assistant on this site doesn&apos;t just answer — it scrolls the page, splits the
            layout, and pins callouts onto the exact entries that answer you. That&apos;s five tool
            definitions and about four hundred lines. The interesting part isn&apos;t the feature;
            it&apos;s the three ways it can fail, and what stops each one.
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
              So tools are constructed <strong className="text-text">per request</strong>, closed
              over the content that actually exists. Validation happens before anything reaches the
              browser:
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
          </Section>

          <Section n="02" title="The model cannot send email — by construction">
            <p>
              This site has a contact form the assistant can fill in. The obvious implementation is
              a <code className="text-accent">sendEmail</code> tool, and it&apos;s a mistake.
            </p>
            <p>
              Anything a visitor types reaches the model. Prompt injection against a bot that can
              only talk is embarrassing. Against a bot that can send mail, it&apos;s an open relay
              pointed at your own inbox — and no amount of instruction-hardening turns that into a
              guarantee, because instructions are exactly what an injection attacks.
            </p>
            <p>
              So the capability doesn&apos;t exist. The model can call{" "}
              <code className="text-accent">draftContactMessage</code>, which renders an editable
              card. Sending is an ordinary HTTP request the browser makes after a human clicks
              Send. There is no tool to abuse, so the guarantee doesn&apos;t depend on the prompt
              holding.
            </p>
            <p className="text-text">
              The general form: when a capability is dangerous, removing it beats defending it.
              A test asserts no tool matching <code className="text-accent">/send|email|mail/</code>{" "}
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
              Every action shows as a pill in the transcript —{" "}
              <code className="text-accent">↳ focused Experience · highlighted 2 roles</code> — so
              the agency reads as deliberate rather than as the page having a mind of its own.
            </p>
            <p>
              Accessibility isn&apos;t a coat of paint here. Scrolling a viewport leaves a keyboard
              user exactly where they were, so navigation moves real focus to the section heading
              and announces through an <code className="text-accent">aria-live</code> region.{" "}
              <code className="text-accent">prefers-reduced-motion</code> swaps smooth scroll for
              instant jumps.
            </p>
          </Section>

          <Section n="04" title="Why there's no vector database">
            <p>
              A portfolio is a few kilobytes. Serialised whole — every role, project and skill,
              plus live GitHub and LeetCode figures — this one is about 1,700 tokens. Retrieval
              over that is strictly worse: an embedding call on the request path, a similarity
              threshold to tune, and a new failure mode where the right chunk doesn&apos;t come
              back.
            </p>
            <p>
              So it all goes in the prompt. The seam is still there —{" "}
              <code className="text-accent">ContextProvider</code> has one implementation today and
              a pgvector one is a one-file swap — but building it now would be complexity bought
              against a problem this site doesn&apos;t have.
            </p>
            <p className="text-text">
              Knowing when RAG isn&apos;t the answer is part of knowing how to build it.
            </p>
          </Section>

          <Section n="05" title="Testing an LLM feature without an LLM">
            <p>
              Every property above is verified without an API key. Tools are pure functions of
              content and arguments, so the tests hand them fabricated IDs and assert the
              rejection, hand them a mixed batch and assert the partial accept, and assert no
              send-shaped tool exists.
            </p>
            <p>
              133 checks run in about two seconds, covering the tool layer, theme-token parity,
              contrast in both modes, structured data, and Google Drive link conversion. What they
              can&apos;t test is whether the model chooses to call the right tool — that&apos;s a
              judgment, and judgments need evals rather than assertions.
            </p>
          </Section>
        </div>

        <footer className="mt-16 border-t border-hairline pt-8">
          <p className="text-muted">
            Next.js, the Vercel AI SDK, Supabase, and OpenAI for tool calling. The source is{" "}
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
