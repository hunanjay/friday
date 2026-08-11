-- Universal mail account registry: one row per bound mailbox per user.
-- A single user can bind multiple mailboxes (user_id is NOT the primary key).
-- Preset provider server addresses live in backend config; these imap_/smtp_
-- columns only hold custom overrides (provider = 'custom' or user overrides).
-- Credentials are ALWAYS stored encrypted (credential_ciphertext) - RLS is
-- not encryption.

create table if not exists public.mail_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null,                -- microsoft / netease / qq / gmail / icloud / custom
  email_address text not null,
  auth_type text not null default 'app_password',  -- oauth2 / app_password
  username text not null default '',
  credential_ciphertext text not null,
  imap_host text,
  imap_port integer,
  imap_security text,                    -- ssl / starttls / none
  smtp_host text,
  smtp_port integer,
  smtp_security text,
  status text not null default 'verified',  -- verified / error / disabled
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.mail_accounts enable row level security;
-- No policies defined: RLS with zero policies denies all access via the
-- anon/authenticated roles. Only the service_role key (used server-side
-- only) bypasses RLS entirely, so this table is unreachable from the client.

create index if not exists mail_accounts_user_idx on public.mail_accounts (user_id);
