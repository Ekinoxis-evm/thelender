-- thelender / KreditoOne — ENSv2 credit-identity tables
-- Off-chain data: the private credit SCORE and the issued-subname mirror.
-- Onchain holds ownership + the tamper-evident approved/denied status (see contracts/kredito).
-- Auth is Privy (no Supabase auth.uid()) → keep the repo posture: RLS ON, no anon/authenticated
-- policies, so every table is reachable only via the service-role key (server-side). The public
-- profile "card" is served by a server route that returns ONLY non-sensitive columns; the score
-- never leaves the server. Reuses public.set_updated_at() from 0001_init.sql.

-- ── credit_decisions: the CRE / Confidential-AI-Attester output. The SCORE lives ONLY here. ──
create table if not exists public.credit_decisions (
  wallet_address        text primary key,
  status                text not null default 'pending'
                          check (status in ('pending','approved','denied','review','defaulted')),
  combined_score        int  check (combined_score between 0 and 1000),   -- PRIVATE — never onchain, never to client
  confidential_ai_score int  check (confidential_ai_score between 0 and 1000),
  bureau_score          int  check (bureau_score between 0 and 1000),
  risk_tier             text check (risk_tier in ('low','medium','high')),
  attestation_hash      text,   -- digest of the attester output (this is what goes onchain)
  bureau_report_hash    text,
  evidence_digest       text,
  expires_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.credit_decisions is
  'CRE/Confidential-AI-Attester credit decisions. combined_score is PRIVATE (service-role only) and never goes onchain.';

alter table public.credit_decisions enable row level security;  -- no policies → service-role only

drop trigger if exists trg_credit_decisions_updated_at on public.credit_decisions;
create trigger trg_credit_decisions_updated_at
  before update on public.credit_decisions
  for each row execute function public.set_updated_at();

-- ── ens_identities: mirror of each issued <label>.kredito.eth subname (no score here). ──
create table if not exists public.ens_identities (
  label            text primary key,                 -- normalized subname label (ENSIP-15), e.g. "acme"
  wallet_address   text not null unique,              -- owner / business wallet (one identity per wallet)
  full_name        text,                              -- "acme.kredito.eth"
  node             text,                              -- ENSv2 namehash (0x…), keccak256(parentNode, keccak256(label))
  status           text not null default 'approved',  -- mirror of the onchain kredito.status credential
  -- user-editable profile (mirrors the resolver's owner-writable text records) →
  url              text,
  twitter          text,                              -- com.twitter handle
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

alter table public.ens_identities enable row level security;  -- no policies → service-role only

drop trigger if exists trg_ens_identities_updated_at on public.ens_identities;
create trigger trg_ens_identities_updated_at
  before update on public.ens_identities
  for each row execute function public.set_updated_at();
