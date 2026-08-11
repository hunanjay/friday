create table if not exists public.netease_tokens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  account text not null,
  auth_code text not null,
  updated_at timestamptz not null default now()
);

alter table public.netease_tokens enable row level security;
