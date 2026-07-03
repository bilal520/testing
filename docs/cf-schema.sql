-- ════════════════════════════════════════════════════════════════════════════
-- Counterfeit / Impersonator Hunter — schema. Idempotent; paste into Supabase.
-- Extends the existing counterfeit_pages (text scan) into a multi-signal hunter.
-- See docs/COUNTERFEIT_HUNTER_SPEC.md.
-- ════════════════════════════════════════════════════════════════════════════

-- extend the pages table with scoring + evidence + workflow
alter table counterfeit_pages add column if not exists scam_score      int default 0;
alter table counterfeit_pages add column if not exists signals         jsonb;      -- {creative,identity,name,domain,copy,behavior}
alter table counterfeit_pages add column if not exists profile_pic_url  text;
alter table counterfeit_pages add column if not exists matched_creatives jsonb;    -- which of ours they stole
alter table counterfeit_pages add column if not exists landing_domains  text[];
alter table counterfeit_pages add column if not exists claude_why       text;
alter table counterfeit_pages add column if not exists cluster_id       text;      -- respawn linkage
alter table counterfeit_pages add column if not exists reported_at      timestamptz;
alter table counterfeit_pages add column if not exists report_refs      jsonb;

-- our reference set (creatives + identity) we match impostors against
create table if not exists cf_reference (
  id        bigint generated always as identity primary key,
  kind      text not null,          -- creative | logo | face
  url       text not null,
  label     text,
  added_at  timestamptz default now()
);

-- manually-flagged suspect pages (always pulled + scored)
create table if not exists cf_watchlist (
  page_id   text primary key,
  note      text,
  added_at  timestamptz default now()
);

notify pgrst, 'reload schema';
