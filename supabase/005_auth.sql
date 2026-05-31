-- Migration 005: authorized-users allowlist for the WP_AI chat app.
-- Only emails in this table can log in and use the app (chat / publish). Add
-- users with scripts/add-user.mjs (it hashes the password). Run in SQL Editor.

create table if not exists authorized_users (
  email         text primary key,
  password_hash text not null,         -- scrypt: "saltHex:hashHex"
  name          text,
  created_at    timestamptz not null default now()
);

-- RLS enabled with NO policies → anon/authenticated have zero access. Only the
-- server (service_role, which bypasses RLS) can read/write this table. The
-- public anon key can never see credentials.
alter table authorized_users enable row level security;
