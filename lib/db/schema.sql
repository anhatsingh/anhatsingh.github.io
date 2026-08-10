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
  highlights  text[] not null default '{}',
  tech        text[] not null default '{}',
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
  sort_order  int not null default 0,
  is_published boolean not null default true,
  updated_at  timestamptz not null default now()
);

create table if not exists skills (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  category    text not null default 'Other',
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
  external_url text not null,
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
alter table experience     add column if not exists logo_url text;
alter table education      add column if not exists logo_url text;
alter table certifications add column if not exists logo_url text;

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
