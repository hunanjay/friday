alter table public.github_tokens
  add column if not exists repos text[] not null default '{}';
