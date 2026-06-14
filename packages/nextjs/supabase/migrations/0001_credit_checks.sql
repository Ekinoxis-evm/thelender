-- Kredito — store every confidential credit check.
-- PRIVACY: only normalized results, content hashes and the Chainlink request id are
-- stored. Raw documents and full bureau reports never touch the database.
--
-- Apply: paste into the Supabase SQL editor, or `supabase db push` if the CLI is linked.

create table if not exists public.credit_checks (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  borrower           text,                       -- connected wallet (credit identity)
  inference_id       text not null,              -- Chainlink Confidential AI request id
  model              text,
  attested           boolean not null default false,
  combined_score     integer,
  ai_score           integer,
  bureau_score       integer,
  risk_tier          text,
  eligible           boolean,
  attestation_hash   text,
  bureau_report_hash text,
  evidence_digest    text,
  legal_name         text,
  country            text,
  industry           text,
  requested_loan_usd numeric
);

create index if not exists credit_checks_borrower_idx on public.credit_checks (borrower);
create index if not exists credit_checks_created_at_idx on public.credit_checks (created_at desc);

-- RLS enabled, no public policies: anon/auth roles cannot read or write. Writes are
-- done server-side with the service-role key (bypasses RLS). Privacy by default.
alter table public.credit_checks enable row level security;
