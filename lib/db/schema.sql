-- =====================================================================
-- Portfolio schema for Supabase
-- Run in the Supabase SQL editor. Idempotent: safe to re-run.
-- =====================================================================
--
-- Design notes:
--   * `slug` is the stable address the chatbot uses in tool calls
--     ("experience:ml-engineer-acme"). It is UNIQUE and should be treated as
--     write-once — renaming one breaks the link between an answer and the
--     highlighted element on screen.
--   * RLS lets the anon role read ONLY published rows. Writes are closed to
--     anon entirely; admin mutations go through the service-role key on the
--     server, which bypasses RLS.
--   * contact_messages is insert-nobody / read-nobody for anon: inserts happen
--     server-side via service role after the human confirms in the UI.

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

create table if not exists profile (
  id              int primary key default 1,
  name            text not null,
  headline        text not null,
  tagline         text not null default '',
  bio             text not null default '',
  location        text,
  email           text not null,
  avatar_url      text,
  resume_url      text,
  open_to_work    boolean not null default true,
  github_username text,
  leetcode_username text,
  linkedin_url      text,
  x_url             text,
  kaggle_url        text,
  huggingface_url   text,
  hashnode_url      text,
  peerlist_url      text,
  medium_url        text,
  stackoverflow_url text,
  devto_url         text,
  -- Platform keys hidden from the site. One array beats a boolean per platform.
  hidden_socials    text[] not null default '{}',
  -- Repos hand-picked in /admin/repos to feed the language chart. Empty means
  -- "use the recency default".
  selected_repos    text[] not null default '{}',
  socials         jsonb not null default '{}'::jsonb,
  updated_at      timestamptz not null default now(),
  -- Enforces the singleton: only one row can ever exist.
  constraint profile_singleton check (id = 1)
);

create table if not exists experience (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  role        text not null,
  company     text not null,
  company_url text,
  logo_url    text,
  start_date  text not null,
  end_date    text,
  location    text,
  summary     text not null default '',
  short_summary text not null default '',
  highlights  text[] not null default '{}',
  tech        text[] not null default '{}',
  body        jsonb not null default '[]'::jsonb,
  show_in_blog_list boolean not null default false,
  hero_image_url text,
  sort_order  int not null default 0,
  is_published boolean not null default true,
  updated_at  timestamptz not null default now()
);

create table if not exists projects (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  summary     text not null default '',
  description text not null default '',
  tech        text[] not null default '{}',
  repo_url    text,
  live_url    text,
  image_url   text,
  featured    boolean not null default false,
  started     text,
  ended       text,
  body        jsonb not null default '[]'::jsonb,
  show_in_blog_list boolean not null default false,
  hero_image_url text,
  sort_order  int not null default 0,
  is_published boolean not null default true,
  updated_at  timestamptz not null default now()
);

create table if not exists skills (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  category    text not null default 'Other',
  body        jsonb not null default '[]'::jsonb,
  show_in_blog_list boolean not null default false,
  hero_image_url text,
  sort_order  int not null default 0,
  is_published boolean not null default true,
  updated_at  timestamptz not null default now()
);

create table if not exists education (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  institution text not null,
  degree      text not null,
  field       text,
  start_year  text,
  end_year    text,
  note        text,
  logo_url    text,
  sort_order  int not null default 0,
  is_published boolean not null default true,
  updated_at  timestamptz not null default now()
);

create table if not exists certifications (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,
  name           text not null,
  issuer         text not null,
  issue_date     text,
  credential_url text,
  logo_url       text,
  body        jsonb not null default '[]'::jsonb,
  show_in_blog_list boolean not null default false,
  hero_image_url text,
  sort_order     int not null default 0,
  is_published   boolean not null default true,
  updated_at     timestamptz not null default now()
);

create table if not exists testimonials (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,
  quote          text not null,
  author_name    text not null,
  author_title   text,
  author_company text,
  author_url     text,
  author_image_url text,
  author_email   text,
  received_at    text,
  sort_order     int not null default 0,
  is_published   boolean not null default true,
  updated_at     timestamptz not null default now()
);

create table if not exists writing (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  title        text not null,
  summary      text not null default '',
  image_url    text,
  external_url text,
  body         jsonb not null default '[]'::jsonb,
  show_in_blog_list boolean not null default true,
  hero_image_url text,
  published_at text,
  source       text,
  sort_order   int not null default 0,
  is_published boolean not null default true,
  updated_at   timestamptz not null default now()
);

-- Inbound messages, whether from the contact form or confirmed in the chatbot.
create table if not exists contact_messages (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  email      text not null,
  message    text not null,
  -- 'form' | 'chat' — so Anhat can see which surface converts.
  source     text not null default 'form',
  user_agent text,
  created_at timestamptz not null default now()
);

-- Response cache keyed on a normalised question. Keeps repeat visitors from
-- costing an API call each.
create table if not exists chat_cache (
  id            uuid primary key default gen_random_uuid(),
  question_hash text not null unique,
  question      text not null,
  answer        text not null,
  -- Tool calls are cached alongside the prose so a cache hit still drives the UI.
  actions       jsonb not null default '[]'::jsonb,
  hit_count     int not null default 0,
  created_at    timestamptz not null default now()
);

-- What visitors actually ask. No IP, no session id, no fingerprint: the useful
-- signal is which questions recur, and storing anything identifying would mean
-- a privacy policy this site doesn't otherwise need.
create table if not exists chat_questions (
  id         uuid primary key default gen_random_uuid(),
  question   text not null,
  created_at timestamptz not null default now()
);

alter table chat_questions enable row level security;

create index if not exists chat_questions_created_idx on chat_questions (created_at desc);
-- Which posts belong to which experience / project / skill / certification.
-- A join table rather than an array column: the relationship is queried from
-- both ends — "posts about this job" on a detail page, and "what is this post
-- about" when building the chatbot's context.
create table if not exists content_links (
  id          uuid primary key default gen_random_uuid(),
  post_slug   text not null,
  target_type text not null,
  target_slug text not null,
  created_at  timestamptz not null default now(),
  unique (post_slug, target_type, target_slug),
  constraint content_links_target_type_check
    check (target_type in ('experience','projects','skills','certifications'))
);

alter table content_links enable row level security;

drop policy if exists "public read content_links" on content_links;
create policy "public read content_links" on content_links
  for select to anon, authenticated using (true);

create index if not exists content_links_post_idx on content_links (post_slug);
create index if not exists content_links_target_idx on content_links (target_type, target_slug);

create index if not exists chat_cache_hash_idx on chat_cache (question_hash);
create index if not exists contact_messages_created_idx on contact_messages (created_at desc);

-- ---------------------------------------------------------------------
-- Migrations
-- ---------------------------------------------------------------------
-- `create table if not exists` above is a no-op on a database that already
-- exists, so it will NOT add columns introduced after the first run. Anything
-- added later needs an explicit alter here. These are idempotent, so re-running
-- the whole file is always safe.

alter table profile        add column if not exists avatar_url text;
alter table profile        add column if not exists leetcode_username text;
alter table profile        add column if not exists linkedin_url text;
alter table profile        add column if not exists x_url text;
alter table profile        add column if not exists kaggle_url text;
alter table profile        add column if not exists huggingface_url text;
alter table profile        add column if not exists hashnode_url text;
alter table profile        add column if not exists peerlist_url text;
alter table profile        add column if not exists medium_url text;
alter table profile        add column if not exists stackoverflow_url text;
alter table profile        add column if not exists devto_url text;
alter table profile        add column if not exists hidden_socials text[] not null default '{}';
alter table profile        add column if not exists selected_repos text[] not null default '{}';

-- Detail pages. Every entity that gets its own route needs a body, a flag for
-- whether that page also belongs in /blog, and an optional hero image.
alter table experience     add column if not exists body jsonb not null default '[]'::jsonb;
alter table experience     add column if not exists show_in_blog_list boolean not null default false;
alter table experience     add column if not exists hero_image_url text;
alter table projects       add column if not exists body jsonb not null default '[]'::jsonb;
alter table projects       add column if not exists show_in_blog_list boolean not null default false;
alter table projects       add column if not exists hero_image_url text;
alter table skills         add column if not exists body jsonb not null default '[]'::jsonb;
alter table skills         add column if not exists show_in_blog_list boolean not null default false;
alter table skills         add column if not exists hero_image_url text;
alter table certifications add column if not exists body jsonb not null default '[]'::jsonb;
alter table certifications add column if not exists show_in_blog_list boolean not null default false;
alter table certifications add column if not exists hero_image_url text;

-- writing becomes the posts table. A post with no external_url is hosted here,
-- so that column can no longer be NOT NULL. This is the first `alter column` in
-- the file; it is idempotent (dropping a constraint that's already gone is a
-- no-op) and does not touch existing rows.
alter table writing        alter column external_url drop not null;
alter table writing        add column if not exists body jsonb not null default '[]'::jsonb;
alter table writing        add column if not exists show_in_blog_list boolean not null default true;
alter table writing        add column if not exists hero_image_url text;
alter table experience     add column if not exists logo_url text;
alter table education      add column if not exists logo_url text;
alter table certifications add column if not exists logo_url text;

-- Projects had no date of any kind, which is why they came out of the importer
-- in arbitrary order — there was nothing to sort on. Text rather than date to
-- match how experience already stores "YYYY-MM", where the day is never known.
alter table projects       add column if not exists started text;
alter table projects       add column if not exists ended text;

-- The homepage needs a line, not a paragraph. Kept separate from `summary` so
-- shortening the card can never quietly destroy the longer text the detail
-- page and the chatbot both read.
alter table experience     add column if not exists short_summary text not null default '';

-- A recommendation carries more weight when you can see who wrote it.
alter table testimonials   add column if not exists author_image_url text;
alter table testimonials   add column if not exists author_email text;

-- When the recommendation was written. LinkedIn's export carries it, and
-- without it a testimonial has no place on a dated timeline.
alter table testimonials   add column if not exists received_at text;

-- ---------------------------------------------------------------------
-- Retrieval (pgvector)
-- ---------------------------------------------------------------------
-- Long-form bodies don't fit in the chat prompt alongside everything else, so
-- they're embedded and retrieved on demand. Summaries and titles stay in the
-- prompt always, which is what stops the bot from failing to know a page exists
-- just because retrieval missed it.

create extension if not exists vector;

create table if not exists content_chunks (
  id           uuid primary key default gen_random_uuid(),
  source_type  text not null,
  source_slug  text not null,
  chunk_index  int  not null,
  content      text not null,
  -- 1536 = text-embedding-3-small. Changing model means changing this column
  -- and re-embedding everything; the dimension is not negotiable per-row.
  embedding    vector(1536),
  updated_at   timestamptz not null default now(),
  unique (source_type, source_slug, chunk_index)
);

alter table content_chunks enable row level security;
-- No anon policy: retrieval runs server-side with the service role. Chunks are
-- derived from public content, but there's no reason to expose the whole corpus
-- for enumeration.

create index if not exists content_chunks_source_idx
  on content_chunks (source_type, source_slug);

-- ivfflat needs rows before it can build meaningful lists, so this is created
-- but will simply be unused until the table fills. Re-run ANALYZE after a bulk
-- reindex if queries stay slow.
create index if not exists content_chunks_embedding_idx
  on content_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Cosine distance: `<=>` is smallest-is-nearest, so similarity is 1 - distance.
create or replace function match_content_chunks(
  query_embedding vector(1536),
  match_count int default 5,
  min_similarity float default 0.15
)
returns table (
  source_type text,
  source_slug text,
  content text,
  similarity float
)
language sql stable
as $$
  select
    c.source_type,
    c.source_slug,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity
  from content_chunks c
  where c.embedding is not null
    and 1 - (c.embedding <=> query_embedding) > min_similarity
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------

alter table profile          enable row level security;
alter table experience       enable row level security;
alter table projects         enable row level security;
alter table skills           enable row level security;
alter table education        enable row level security;
alter table certifications   enable row level security;
alter table testimonials     enable row level security;
alter table writing          enable row level security;
alter table contact_messages enable row level security;
alter table chat_cache       enable row level security;

-- Public read of published content. No insert/update/delete policy is defined
-- for anon anywhere, and with RLS on, absence of a policy means denial.
drop policy if exists "public read profile" on profile;
create policy "public read profile" on profile for select to anon, authenticated using (true);

do $$
declare t text;
begin
  foreach t in array array['experience','projects','skills','education','certifications','testimonials','writing']
  loop
    execute format('drop policy if exists "public read %1$s" on %1$I', t);
    execute format(
      'create policy "public read %1$s" on %1$I for select to anon, authenticated using (is_published = true)',
      t
    );
  end loop;
end $$;

-- contact_messages and chat_cache intentionally get NO anon policy:
-- all access is server-side via the service role key.

-- ---------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------

create or replace function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['profile','experience','projects','skills','education','certifications','testimonials','writing']
  loop
    execute format('drop trigger if exists touch_%1$s on %1$I', t);
    execute format(
      'create trigger touch_%1$s before update on %1$I for each row execute function touch_updated_at()',
      t
    );
  end loop;
end $$;
