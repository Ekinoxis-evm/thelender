-- Kreditos — admin-managed AI configuration (model + Confidential-AI system prompts).
-- Stored here so prompts/model can be reviewed and updated from /admin without a redeploy
-- (e.g. a monthly model review). The score pipeline reads the active row via getAiConfig(),
-- falling back to the in-code defaults in services/lendsignal/prompt.ts. Append-only history:
-- a new active row deactivates the previous one, so past configs stay reviewable.
-- Self-contained: defines its own set_updated_at() so it can be applied independently.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.ai_config (
  id                    uuid primary key default gen_random_uuid(),
  model                 text not null default 'gemma4',
  credit_system_prompt  text,
  section_system_prompt text,
  reduce_system_prompt  text,
  profile_system_prompt text,
  notes                 text,
  active                boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists ai_config_active_idx on public.ai_config (active, created_at desc);

comment on table public.ai_config is 'Admin-managed AI model + system prompts; pipeline reads the active row (falls back to code defaults).';

alter table public.ai_config enable row level security;  -- no policies → service-role only

drop trigger if exists trg_ai_config_updated_at on public.ai_config;
create trigger trg_ai_config_updated_at
  before update on public.ai_config
  for each row execute function public.set_updated_at();
