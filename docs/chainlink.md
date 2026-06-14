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
   id (surfaced to the UI).
2. **REDUCE** — a final inference that weighs the per-section analyses into the overall credit
   decision.
3. An off-chain profile signal is computed in parallel (mocked, deterministic) and shown apart — it
   is **not** blended into the on-chain score.
4. A **CRS bureau** signal (mock) is computed, then blended:
   **`combined = (ai * 7000 + bureau * 3000) / 10000`** — i.e. 70% Confidential-AI / 30% bureau
   (`AI_WEIGHT_BPS` / `BUREAU_WEIGHT_BPS` in `services/lendsignal/score.ts`, mirroring
   `CreditTypes.sol`).

The normalized check is persisted to Supabase (`credit_checks`, best-effort — never blocks the
response). The combined score and risk tier then feed the issuer's EIP-712 attestation (see
`docs/eip-712-attestation.md`).

`attested: true` requires the reduce inference AND at least one section inference to complete inside
the TEE.

### Env

| Var | Purpose | Default |
|-----|---------|---------|
| `CHAINLINK_CONFIDENTIAL_AI_API_KEY` | Secret, server-only. Empty → deterministic mock fallback. | _(unset)_ |
| `CHAINLINK_CONFIDENTIAL_AI_BASE_URL` | Attester base URL (trailing slashes stripped). | `https://confidential-ai-dev-preview.cldev.cloud` |
| `CHAINLINK_CONFIDENTIAL_AI_MODEL` | Model id. | `gemma4` |

### Mock fallback

When `CHAINLINK_CONFIDENTIAL_AI_API_KEY` is unset, the route returns a **deterministic mock**
(`fallbackAiResult` / `fallbackOffchain`, marked `attested: false`) keyed off a borrower-strength
hint, so the full Onboarding → Score → Identity flow works end-to-end without a live key. Demo
profiles also land on a fixed score band regardless of live-model variance.

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
