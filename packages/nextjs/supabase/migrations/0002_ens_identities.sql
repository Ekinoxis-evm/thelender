-- Kreditos — ENS credit-identity mirror.
-- Off-chain mirror of each issued `<label>.kredito.eth` subname: status + the user-editable profile
-- records (which also live on-chain in KreditoResolver). The private credit score is NOT here — it
-- stays in `credit_checks` (0001). Source of truth for the profile card.
-- Consolidated migration set lives in packages/nextjs/supabase/migrations/.

-- Shared updated_at trigger fn (self-contained; pinned search_path per Supabase advisor).
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

create table if not exists public.ens_identities (
  label            text primary key,                 -- normalized subname label (ENSIP-15), e.g. "acme"
  wallet_address   text not null unique,              -- owner / business wallet (one identity per wallet)
  full_name        text,                              -- "acme.kredito.eth"
  node             text,                              -- ENSv2 namehash (0x…)
  status           text not null default 'approved',  -- mirror of the on-chain kredito.status credential
  -- user-editable profile (mirrors the resolver's owner-writable text records) --
  display_name     text,
  description      text,
  avatar_url       text,
  header_url       text,
  url              text,
  email            text,
  location         text,
  twitter          text,
  github           text,
  telegram         text,
  discord          text,
  linkedin         text,
  -- issuance anchors --
  attestation_hash text,                              -- Chainlink attestation = the ENS "financial ID"
  token_id         numeric,
  tx_hash          text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.ens_identities is
  'Off-chain mirror of issued ENSv2 subnames under kredito.eth. Profile card source of truth; no score.';

alter table public.ens_identities enable row level security;  -- no policies → service-role only

drop trigger if exists trg_ens_identities_updated_at on public.ens_identities;
create trigger trg_ens_identities_updated_at
  before update on public.ens_identities
  for each row execute function public.set_updated_at();
