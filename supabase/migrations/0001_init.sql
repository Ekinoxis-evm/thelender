-- thelender — initial schema
-- Off-chain data lives here; onchain is for ownership/transfers (see CLAUDE.md).
-- This app authenticates with Privy (not Supabase Auth), so there is no auth.uid().
-- Default posture: RLS ON, no anon/authenticated policies → tables are reachable only
-- via the service-role key (server-side). Bridge Privy → Supabase later to add
-- per-user client access. See docs/infra.md.

-- ── profiles: one row per wallet (smart wallet address) ──
create table if not exists public.profiles (
  wallet_address text primary key,
  ens_name       text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.profiles is 'thelender user profiles, keyed by smart wallet address';

-- RLS on, no policies yet → server/service-role access only (secure default).
alter table public.profiles enable row level security;

-- keep updated_at fresh
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''  -- pin search_path (security best practice; now() is in pg_catalog)
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();
