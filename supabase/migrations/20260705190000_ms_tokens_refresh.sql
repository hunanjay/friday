alter table public.ms_tokens
  add column if not exists refresh_token text,
  add column if not exists expires_at timestamptz;
