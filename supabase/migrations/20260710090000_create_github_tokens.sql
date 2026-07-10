create table if not exists public.github_tokens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  token text not null,
  updated_at timestamptz not null default now()
);

alter table public.github_tokens enable row level security;
-- No policies defined: RLS with zero policies denies all access via the
-- anon/authenticated roles. Only the service_role key (used server-side
-- only) bypasses RLS entirely, so this table is unreachable from the client.
-- GitHub OAuth App user tokens don't expire and have no refresh_token, so
-- unlike ms_tokens there's no refresh_token/expires_at to add later.
