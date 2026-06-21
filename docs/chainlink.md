# Chainlink Integration Notes — Kredito

Kredito's one live Chainlink integration is the **Confidential AI Attester**, used to credit-score a
borrower's private financial documents inside a TEE. Other Chainlink products (Data Feeds, VRF, CCIP,
Data Streams, CRE, ACE) are available via the installed skills but **unused** in the current product.

Skills live at `.claude/skills/chainlink-*` (symlinked from `.agents/skills/`).

## Confidential AI Attester — credit scoring (the live integration)

The Attester runs LLM inference inside an **AWS Nitro Enclave (TEE)**: the borrower's raw documents
(bank statements, tax returns, A/R, debt schedules, …) are sent to the enclave, analyzed, and a
result comes back with a **cryptographic attestation** of what model ran on what data. The raw
documents **never leave the enclave** and never touch the chain — only the score, decision, and
attestation references surface.

Client (server-only): `packages/nextjs/services/lendsignal/confidentialAi.ts`. The API key is a
secret read from a non-public env var and imported only by the route handler (`"server-only"`), never
from a client component.

API shape (poll-based):
```
POST /v1/inference        -> { id, status: "queued" }
GET  /v1/inference/:id     -> poll until status completed | failed
```
`runInference()` submits then polls to a terminal state (3s interval; ~90 attempts for PDFs, which go
through Docling preprocessing in the TEE and can take minutes — the demo prefers small text docs).

### Scoring pipeline — `POST /api/lendsignal/score`

`packages/nextjs/services/lendsignal/pipeline.ts` runs a **map → reduce** over the documents:

1. **MAP** — one Confidential AI inference **per document**, in parallel, each with a section-specific
   prompt (financials / tax / bank / A/R / debt / legal). Each query keeps its own attested request
   id (surfaced to the UI). `parseSectionOutput` **throws a clear Error** if a section returns missing
   or unparseable output — there is no synthetic fallback.
2. **REDUCE** — a final inference that weighs the per-section analyses into the overall credit
   decision. `parseReduceOutput` likewise **throws** on missing/unparseable output.

The combined score **is** the AI score (`combinedScore === aiScore` in
`services/lendsignal/score.ts`): there is **no** credit-bureau blend, **no** off-chain profile signal,
and **no** 70/30 weighting. Tiers are `>=750` low · `400–749` medium · `<400` high, and
`eligible = score >= 400 && tier != high` (`MIN_ELIGIBLE_SCORE = 400`).

The normalized check is persisted to Supabase (`credit_checks`, best-effort — never blocks the
response). The combined score and risk tier then feed the issuer's EIP-712 attestation (see
`docs/eip-712-attestation.md`), whose `maxPrincipal` credit limit is derived from the score
(`creditLimitUsd`).

`attested: true` requires the reduce inference AND at least one section inference to complete inside
the TEE.

### Env

| Var | Purpose | Default |
|-----|---------|---------|
| `CHAINLINK_CONFIDENTIAL_AI_API_KEY` | Secret, server-only. **Required** — if missing, the score route returns a clear error (no fake score). | _(unset)_ |
| `CHAINLINK_CONFIDENTIAL_AI_BASE_URL` | Attester base URL (trailing slashes stripped). | `https://confidential-ai-dev-preview.cldev.cloud` |
| `CHAINLINK_CONFIDENTIAL_AI_MODEL` | Model id. | `gemma4` |

### No mock fallback

There is **no** synthetic/mock scoring path. If `CHAINLINK_CONFIDENTIAL_AI_API_KEY` is unset, or any
section/reduce inference fails or returns unparseable output, `POST /api/lendsignal/score` returns a
**clear error** and the UI surfaces it — the app never fabricates a score. (No `fallbackAiResult`,
no deterministic mock, no fixed demo score bands.)

Docs/skill: `.agents/skills/chainlink-confidential-ai-attester-skill/SKILL.md` ·
`https://confidential-ai-dev-preview.cldev.cloud/docs`.

## Other Chainlink products (available, not used)

| Need | Skill |
|------|-------|
| Price / asset data on-chain | `chainlink-data-feeds-skill` (`AggregatorV3Interface`) |
| Low-latency pull-based data | `chainlink-data-streams-skill` |
| Verifiable randomness | `chainlink-vrf-skill` (VRF v2.5) |
| Cross-chain messaging / tokens | `chainlink-ccip-skill` (CCIP, CCT) |
| Off-chain compute / PoR | `chainlink-cre-skill` |
| Compliance / identity tokens | `chainlink-ace-skill` |

If any of these are introduced later, the non-negotiable rules still apply: never use a spot/DEX price
as an oracle (flash-loanable — use a Data Feed); verify the feed address on the target chain with
`cast code` before using it; always check `updatedAt` staleness against the heartbeat and confirm the
feed's decimals; fund VRF/CCIP subscriptions/lanes and track their ids per environment.
