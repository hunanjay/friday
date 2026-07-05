create table if not exists public.ms_tokens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  token text not null,
  updated_at timestamptz not null default now()
);

alter table public.ms_tokens enable row level security;
-- No policies defined: RLS with zero policies denies all access via the
-- anon/authenticated roles. Only the service_role key (used server-side
-- only) bypasses RLS entirely, so this table is unreachable from the client.
