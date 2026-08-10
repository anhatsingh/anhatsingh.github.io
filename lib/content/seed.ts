import type { Block } from "./blocks";
import type { Portfolio } from "./types";

/*
  SEED CONTENT
  ============
  This is what renders before Supabase is wired up, and what gets inserted as the
  initial rows afterwards.

  Education and social handles are REAL (carried over from the 2021 site).
  Everything under `experience`, `projects`, `testimonials` and `writing` is
  PLACEHOLDER — written to be plausible for a mid-level AI/ML engineer so the
  chatbot has something meaty to reason over on day one. Replace it from /admin.

  The placeholder set is deliberately RAG- and LLM-heavy, because the demo
  question "what has he built with RAG?" needs real matches to highlight.
*/

export const IS_SEED_CONTENT = true;

const rawSeed = {
  profile: {
    name: "Anhat Singh",
    headline: "I teach machines to do my job.",
    tagline: "AI/ML Engineer",
    bio: "I build LLM systems that survive contact with actual users — retrieval pipelines that return the right chunk, evals that catch the regression before the customer does, and inference that doesn't fall over at 3am. Mostly Python and TypeScript. Occasionally I write the frontend too, as this site regrettably demonstrates.",
    location: "Punjab, India",
    email: "anhatsingh2001@gmail.com",
    // Empty means "use the bundled default" (public/anhat.jpg, statically
    // imported by the components so it gets a content-hashed URL). Set any URL
    // here or from /admin to override it.
    //
    // Deliberately NOT the literal string "/anhat.jpg": that path is cached by
    // Next's image optimizer keyed on the URL, so replacing the file under the
    // same name keeps serving the old photo. The static import sidesteps that
    // entirely — new file contents produce a new hash, hence a new URL.
    avatarUrl: "",
    resumeUrl: "",
    openToWork: true,
    githubUsername: "anhatsingh",
    leetcodeUsername: "anhatsingh",
    // GitHub and LeetCode links are derived from the usernames above by
    // socialLinks(), so there's nothing to duplicate here.
    linkedinUrl: "https://linkedin.com/in/anhat-singh/",
    kaggleUrl: "https://www.kaggle.com/anhatsingh",
    hashnodeUrl: "https://hashnode.com/@anhatsingh",
    xUrl: "https://x.com/anhatsingh",
    hiddenSocials: [],
  },

  experience: [
    {
      slug: "ml-engineer-placeholder-co",
      role: "Machine Learning Engineer",
      company: "Placeholder Co",
      startDate: "2024-03",
      endDate: null,
      location: "Remote",
      summary:
        "Own the retrieval and evaluation stack behind a customer-facing LLM assistant serving ~40k monthly conversations.",
      highlights: [
        "Rebuilt the RAG pipeline around hybrid search (BM25 + dense) with a cross-encoder reranker, lifting answer-groundedness from 71% to 92% on our internal eval set.",
        "Built an offline eval harness with golden datasets and LLM-as-judge scoring, wired into CI so prompt changes can't ship a regression.",
        "Cut p95 inference latency 2.4s → 900ms via streaming, semantic caching, and moving embedding generation off the request path.",
      ],
      tech: ["Python", "PyTorch", "pgvector", "FastAPI", "LangChain", "Postgres"],
    },
    {
      slug: "data-engineer-placeholder-labs",
      role: "Data Engineer",
      company: "Placeholder Labs",
      startDate: "2022-06",
      endDate: "2024-02",
      location: "Bengaluru, India",
      summary:
        "Built and ran the batch + streaming pipelines that fed every downstream model and dashboard.",
      highlights: [
        "Designed an Airflow-orchestrated ELT platform moving ~200GB/day into a partitioned warehouse.",
        "Introduced contract testing on ingestion, which took silent schema-drift incidents from roughly monthly to zero.",
        "Mentored two junior engineers through their first production on-call rotation.",
      ],
      tech: ["Python", "Airflow", "dbt", "Spark", "BigQuery", "Docker"],
    },
    {
      slug: "software-engineer-placeholder-studio",
      role: "Software Engineer",
      company: "Placeholder Studio",
      startDate: "2021-07",
      endDate: "2022-05",
      location: "Remote",
      summary: "Full-stack product work on a small team where everyone touched everything.",
      highlights: [
        "Shipped the customer-facing analytics dashboard end to end, from schema to charts.",
        "Automated a manual reporting process that had been eating ~10 hours a week.",
      ],
      tech: ["TypeScript", "React", "Node.js", "Postgres"],
    },
  ],

  projects: [
    {
      slug: "this-website",
      name: "This website",
      summary: "A portfolio whose chatbot actually drives the page.",
      description:
        "The chat on this site isn't a Q&A box bolted into a corner — it calls tools that scroll the page, split the layout, and pin callouts onto the exact entries that answer your question. Built with Next.js and the Vercel AI SDK, with every tool argument validated against the real content IDs so a hallucinated reference can never produce a dead highlight.",
      tech: ["Next.js", "TypeScript", "AI SDK", "OpenAI", "Supabase", "Tailwind"],
      repoUrl: "https://github.com/anhatsingh/anhatsingh.github.io",
      featured: true,
    },
    {
      slug: "rag-eval-harness",
      name: "RAG Eval Harness",
      summary: "Catch retrieval regressions before your users do.",
      description:
        "An opinionated harness for evaluating retrieval-augmented generation: golden question sets, retrieval hit-rate and MRR, groundedness scoring via LLM-as-judge, and a diff view that shows exactly which chunks changed between two runs. Runs in CI and fails the build on regression.",
      tech: ["Python", "pytest", "pgvector", "OpenAI"],
      featured: true,
    },
    {
      slug: "semantic-cache",
      name: "Semantic Cache",
      summary: "Embedding-similarity caching layer for LLM calls.",
      description:
        "A drop-in cache that matches semantically equivalent prompts rather than exact strings, with a tunable similarity threshold and TTL. Cut spend meaningfully on a workload with heavy question repetition.",
      tech: ["Python", "Redis", "pgvector"],
      featured: false,
    },
    {
      slug: "doc-chunker",
      name: "Document Chunker",
      summary: "Structure-aware chunking that doesn't split mid-table.",
      description:
        "Most chunkers slice on token count and happily bisect a table or code block. This one parses document structure first, then packs semantically whole units into chunks — measurably better retrieval on technical docs.",
      tech: ["Python", "Tree-sitter", "unstructured"],
      featured: false,
    },
  ],

  skills: [
    { slug: "python", name: "Python", category: "Languages" },
    { slug: "typescript", name: "TypeScript", category: "Languages" },
    { slug: "sql", name: "SQL", category: "Languages" },
    { slug: "pytorch", name: "PyTorch", category: "ML" },
    { slug: "rag", name: "RAG", category: "ML" },
    { slug: "llm-evals", name: "LLM Evaluation", category: "ML" },
    { slug: "fine-tuning", name: "Fine-tuning", category: "ML" },
    { slug: "embeddings", name: "Embeddings", category: "ML" },
    { slug: "pgvector", name: "pgvector", category: "Data" },
    { slug: "postgres", name: "Postgres", category: "Data" },
    { slug: "airflow", name: "Airflow", category: "Data" },
    { slug: "spark", name: "Spark", category: "Data" },
    { slug: "fastapi", name: "FastAPI", category: "Backend" },
    { slug: "nextjs", name: "Next.js", category: "Frontend" },
    { slug: "react", name: "React", category: "Frontend" },
    { slug: "docker", name: "Docker", category: "Infra" },
    { slug: "aws", name: "AWS", category: "Infra" },
    { slug: "gcp", name: "GCP", category: "Infra" },
  ],

  education: [
    {
      slug: "btech-gndu",
      institution: "Guru Nanak Dev University, Amritsar",
      degree: "B.Tech",
      field: "Computer Science & Engineering",
      startYear: "2017",
      endYear: "2021",
    },
  ],

  certifications: [
    {
      slug: "placeholder-cert",
      name: "Placeholder Certification",
      issuer: "Add yours from /admin",
      issueDate: "2024",
    },
  ],

  testimonials: [
    {
      slug: "placeholder-testimonial",
      quote:
        "Add a real recommendation here from /admin — paste one straight out of LinkedIn. This card is a placeholder so you can see the layout.",
      authorName: "Placeholder Name",
      authorTitle: "Engineering Manager",
      authorCompany: "Placeholder Co",
    },
  ],

  writing: [
    {
      slug: "placeholder-post",
      title: "Add your posts from /admin",
      summary:
        "Writing entries are just link cards — a title, a summary, an image, and a URL pointing at Medium or wherever you publish. No CMS, no markdown pipeline.",
      externalUrl: "https://medium.com",
      source: "Medium",
    },
  ],
};

/*
  Detail-page fields are filled in here rather than repeated on every seed
  entry. Forty copies of `body: [], showInBlogList: false` would bury the actual
  content, and the defaults are genuinely uniform: seed rows have no body and
  none of them belong in the blog index.

  Spreading `item` last means a seed entry can still override either field.
*/
type DetailFields = { body: Block[]; showInBlogList: boolean; heroImageUrl?: string };

function withDetail<T extends object>(items: T[]): Array<T & DetailFields> {
  return items.map((item) => ({ body: [] as Block[], showInBlogList: false, ...item }));
}

export const seedPortfolio: Portfolio = {
  ...rawSeed,
  experience: withDetail(rawSeed.experience),
  projects: withDetail(rawSeed.projects),
  skills: withDetail(rawSeed.skills),
  certifications: withDetail(rawSeed.certifications),
  writing: withDetail(rawSeed.writing),
};
