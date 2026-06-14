# KreditoOne — CRE ingestion contract (stable endpoint)

The seam between the **Chainlink CRE / Confidential-AI-Attester** workflow (built on another branch)
and the **ENSv2 credit-identity** layer. This contract is **versioned and stable** — target it from
any branch; changes are additive within a `version`.

## Endpoint

```
POST /api/cre/decision
Authorization: Bearer <CRE_INGEST_SECRET>
Content-Type: application/json
```

`CRE_INGEST_SECRET` is a shared secret (server env on both sides). The check is constant-time.

## Request body (`version: 1`)

```jsonc
{
  "version": 1,
  "wallet": "0xBusinessWalletAddress",     // required — the credit subject (EVM address)
  "decision": "approved",                   // required — approved | denied | review | defaulted | pending
  "scores": {                               // optional — PRIVATE, stored only in Supabase, never returned/onchain
    "combined": 812,                        //   0..1000
    "confidential_ai": 840,                 //   0..1000  (Confidential-AI-Attester signal)
    "bureau": 745                           //   0..1000  (CRS bureau signal)
  },
  "risk_tier": "low",                       // optional — low | medium | high
  "attestation_hash": "0x…",                // optional — digest of the attester output (this is what goes ONCHAIN)
  "bureau_report_hash": "0x…",              // optional
  "evidence_digest": "0x…",                 // optional
  "expires_at": 1750000000                  // optional — unix seconds
}
```

Only `version`, `wallet`, and `decision` are required. Unknown fields are ignored.

## Response

```jsonc
{ "ok": true, "wallet": "0x…", "status": "approved", "hasIdentity": false, "chainSynced": false }
```

- `hasIdentity` — whether this wallet already minted `<label>.kredito.eth`.
- `chainSynced` — whether a status change was pushed to the on-chain `kredito.status` credential
  (only attempted when the wallet already has an identity AND the status changed AND the issuer is
  configured). Best-effort: the DB is the source of truth; the chain record is the credential mirror.

Errors: `401` (bad/missing secret), `400` (bad version/wallet/decision), `500` (DB error).

## What it does

1. Authenticates the CRE via the bearer secret.
2. Upserts `credit_decisions` keyed by `wallet` (the **private score** lives only here).
3. `approved` → the wallet becomes eligible to mint its identity at `/identity`.
4. If the wallet already minted and the status changed (e.g. → `denied`/`defaulted`), syncs the
   mirror and flips the on-chain `kredito.status` via `KreditoController.setStatus`.

## Example

```bash
curl -X POST "$APP_URL/api/cre/decision" \
  -H "Authorization: Bearer $CRE_INGEST_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"version":1,"wallet":"0xabc…","decision":"approved","scores":{"combined":812},"risk_tier":"low","attestation_hash":"0x…"}'
```

## Notes for the CRE branch

- Send the **attestation_hash** (digest of the attester output) — it is published on-chain as the
  `lendsignal.attestation` record and anchors the credential. Raw documents / the score stay off-chain.
- This endpoint is idempotent per `wallet` (upsert) — safe to retry.
- Auth is a shared secret today; hardening to verify the Confidential-AI-Attester signature directly
  is a future additive change within `version: 1`.
