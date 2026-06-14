-- Kredito — off-chain mirror of issued `<label>.kredito.eth` ENSv2 subnames (the credit identity
-- minted after evaluation). Onchain holds ownership + the issuer-locked approved/denied status;
-- this table is the source of truth for the profile card. NO score lives here — the private score
-- stays in `credit_checks`. Auth is Privy (no Supabase auth.uid()) → RLS ON with no policies, so
-- the table is reachable only via the service-role key (server routes).
-- Self-contained: defines its own set_updated_at() so it can be applied independently.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.ens_identities (
  label            text primary key,                 -- normalized subname label (ENSIP-15), e.g. "acme"
  wallet_address   text not null unique,             -- owner / business wallet (one identity per wallet)
  full_name        text,                             -- "acme.kredito.eth"
  node             text,                             -- ENSv2 namehash (0x…)
  status           text not null default 'approved', -- mirror of the onchain kredito.status credential
  -- user-editable profile (mirrors the resolver's owner-writable text records) →
  url              text,
  twitter          text,                             -- com.twitter handle
  avatar_url       text,
  display_name     text,
  -- issuance anchors →
  attestation_hash text,
  token_id         numeric,
  tx_hash          text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.ens_identities is
  'Off-chain mirror of issued ENSv2 subnames under kredito.eth. Source of truth for the profile card; no score.';

create index if not exists ens_identities_wallet_idx on public.ens_identities (wallet_address);

alter table public.ens_identities enable row level security;  -- no policies → service-role only

drop trigger if exists trg_ens_identities_updated_at on public.ens_identities;
create trigger trg_ens_identities_updated_at
  before update on public.ens_identities
  for each row execute function public.set_updated_at();
