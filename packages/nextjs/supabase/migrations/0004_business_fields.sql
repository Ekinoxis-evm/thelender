-- Kredito — reduce onboarding to 5 business-identity fields. Adds the three new columns to
-- credit_checks (legal_name + country already exist). Idempotent. The legacy industry /
-- requested_loan_usd columns are left in place (nullable, no longer written).

alter table public.credit_checks add column if not exists enterprise_type  text;
alter table public.credit_checks add column if not exists tax_number       text;
alter table public.credit_checks add column if not exists registry_number  text;
