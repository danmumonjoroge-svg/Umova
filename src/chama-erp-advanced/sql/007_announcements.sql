-- =============================================================================
-- 007 — Chama announcements (the "Updates" area of the mobile app)
-- Additive and idempotent. The only new table the redesign needs: nothing in
-- the existing schema stores meeting notices, reminders or Chama notices.
-- Follows the same pattern as the other feature tables: tenant column +
-- explicit add-column-if-not-exists.
-- =============================================================================
create table if not exists chama_announcements (
  id uuid primary key default gen_random_uuid()
);

alter table chama_announcements add column if not exists chama_id uuid not null;
alter table chama_announcements add column if not exists title text not null;
alter table chama_announcements add column if not exists body text;
alter table chama_announcements add column if not exists kind text default 'notice';   -- meeting | reminder | notice
alter table chama_announcements add column if not exists event_date date;              -- set for meetings / dated events
alter table chama_announcements add column if not exists pinned boolean default false;
alter table chama_announcements add column if not exists expires_on date;
alter table chama_announcements add column if not exists created_by uuid references chama_members(id);
alter table chama_announcements add column if not exists created_at timestamptz default now();

create index if not exists idx_announcements_chama on chama_announcements(chama_id, pinned desc, created_at desc);

-- RLS: NOT enabled here, for the same reason as every other feature table in
-- this package (see AUDIT_REPORT P2-1): the app uses custom phone+password
-- auth, so auth.uid() is not available to write policies against yet. Until
-- that decision is made, "only secretary/chairperson can post" is enforced in
-- the UI only. Treat this table as writable by any client holding the anon key.
