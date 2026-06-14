# Kredito — Architecture & Decisions

How the pieces fit, and **why**. Read this before making structural changes.

**Kredito** is a sponsored, gasless, credit-gated **undercollateralized USDC lending** app on
**Ethereum Sepolia (11155111)**. A business uploads financial documents → a Chainlink Confidential
AI Attester scores them inside a TEE → the protocol issuer signs an EIP-712 credit attestation and
mints a `<label>.kredito.eth` ENSv2 credit identity → the business borrows against that attestation
from an attestation-gated ERC-4626 vault. The user pays **no gas** at any step (Privy smart wallets +
managed paymaster).

Built on **Scaffold-ETH 2** (Yarn-4 monorepo: `packages/nextjs` + `packages/foundry`).

## System overview

```
                          ┌────────────────────────────────────────────┐
   User (email/Google) ──▶│  Privy: embedded EOA + ERC-4337 SMART WALLET │
                          └───────────────────┬──────────────────────────┘
                                   signs UserOps / messages
        ┌──────────────────────────────────────┼─────────────────────────────────────┐
        │              packages/nextjs (Next.js App Router · Vercel)                   │
        │   KreditoFlow.tsx · useSponsoredWrite · useSmartWalletSign                    │
        │   /api/lendsignal/{score,attest}  ·  /api/identity/{mint,lookup,[label]}      │
        └───────┬───────────────────────┬──────────────────────────┬──────────────────┘
   sponsored UserOp            server-side (Node)            issuer-signed (server)
                │                        │                          │
   ┌────────────▼───────────┐  ┌─────────▼──────────┐   ┌───────────▼─────────────────┐
   │  Sepolia contracts      │  │ Chainlink           │   │ ISSUER_PRIVATE_KEY (server) │
   │  ─ KreditoController     │  │ Confidential AI     │   │  ─ EIP-712 CreditAttestation│
   │  ─ KreditoResolver       │  │ Attester (TEE/Nitro)│   │  ─ submits controller.mint  │
   │  ─ subRegistry (ENSv2)   │  │ map→reduce inference│   └──────────────┬──────────────┘
   │  ─ KreditoVault (NOT yet)│  └─────────┬──────────┘                  │
   └────────────┬────────────┘            │                             │
                │              ┌───────────▼─────────────────────────────▼──┐
   Privy managed paymaster ───▶│  Supabase (Postgres, RLS, service-role only)│
   ("App pays" gas credits)    │  credit_checks · ens_identities · ai_config │
                               │  profiles                                   │
                               └─────────────────────────────────────────────┘
            ENS reads: viem UniversalResolver → KreditoResolver.resolve() (ENSIP-10)
```

## The credit → identity → loan flow (`components/kredito/KreditoFlow.tsx`)

Five steps. Steps 1–3 are **live**; steps 4–5 depend on the not-yet-deployed `KreditoVault`.

| # | Step | What happens | Where |
|---|------|--------------|-------|
| 1 | **Onboarding** | Business profile + per-slot document upload (6 evidence types: financials, tax, bank, A/R, debt, legal). Demo borrower archetypes / sample-doc cases preloaded. Connected smart-wallet address = the credit identity. | client |
| 2 | **Score** | `POST /api/lendsignal/score` runs a **map→reduce** pipeline: one Confidential AI inference per document (section prompts) → a reduce inference → final decision; plus a mock off-chain profile signal. Blended **70 % AI / 30 % mock CRS bureau** → score `0–1000` + risk tier + `eligible` (≥ 750). Persisted to `credit_checks` (results + content hashes, **no raw docs**). Falls back to a deterministic mock (`attested:false`) when `CHAINLINK_CONFIDENTIAL_AI_API_KEY` is unset. | server |
| 3 | **Certificate / Identity** | (a) `POST /api/lendsignal/attest` — issuer signs an EIP-712 `CreditAttestation`. (b) User signs `mintMessage` (proves wallet control); `POST /api/identity/mint` verifies it (`verifyMessage`, EOA + ERC-1271/6492), checks the Supabase decision is `approved`, then the issuer submits `KreditoController.mint` (Privy-sponsored). Result: a `<label>.kredito.eth` subname the **user owns**, with an **issuer-locked** `kredito.status = approved` + attestation hash. | client + server + onchain |
| 4 | **Borrow** *(deferred)* | `KreditoVault.borrow(attestation, signature, amount)` — the vault recovers `signer == issuer` onchain and checks score ≥ `minScore`, unexpired, `amount ≤ maxPrincipal`. Disburses an undercollateralized loan; gas sponsored. Repay batches `approve + repay` into one UserOp. **Vault not deployed.** | onchain |
| 5 | **Liquidity** *(deferred)* | ERC-4626 deposit + ERC-7540 async redeem (`requestRedeem` → keeper `fulfillRedeem` → `claim`). **Vault not deployed.** | onchain |

## Contracts (`packages/foundry/contracts`)

| Contract | Role | Status |
|----------|------|--------|
| **KreditoController** (`kredito/`) | Issuance authority for `<label>.kredito.eth`. Holds `ROLE_REGISTRAR` on the subregistry — the only thing that can create subnames. `mint(label, business, attestationHash)` (onlyRole `ISSUER_ROLE`) registers the subname to the business and calls `resolver.initIdentity` to stamp the locked `approved` status. `revoke` / `setStatus` flip status (no burn). `AccessControl`: `DEFAULT_ADMIN_ROLE` (cold) rotates the issuer; `ISSUER_ROLE` (hot) mints. | **LIVE** |
| **KreditoResolver** (`kredito/`) | ENSv2 resolver (ENSIP-10 `resolve`, interface `0x9061b923`). Split-ACL records keyed by node — see below. | **LIVE** |
| **KreditoVault** (`lendsignal/KreditoVault.sol`) | One contract = ERC-4626 LP vault **+** EIP-712 attestation-gated undercollateralized lender **+** ERC-7540 async redeem. Domain `"Kredito"/"1"` bound to `chainId` **and** `verifyingContract` (C-1). `Ownable2Step`, `ReentrancyGuard`, `Pausable`. 87 tests. | **BUILT, NOT deployed** |
| **KreditoCreditVault** (`lendsignal/`) | Superseded by `KreditoVault`. | **deprecated** |
| **YourContract** | SE-2 template scaffold. | **deprecated** |

The private credit **score never touches any contract** — it lives only in Supabase. Onchain we keep
only commitments: the identity (ENS name + locked status), the attestation hash, and (once deployed)
the loan/escrow state.

## EIP-712 attestation trust model

The trust anchor is an **issuer signature**, not a registry write. `POST /api/lendsignal/attest`
signs a `CreditAttestation` server-side with `ISSUER_PRIVATE_KEY` (never reaches the client):

```
CreditAttestation(
  address borrower, uint256 score, uint8 riskTier, bytes32 evidenceDigest,
  uint256 issuedAt, uint256 expiresAt, uint256 maxPrincipal )
domain = { name:"Kredito", version:"1", chainId, verifyingContract: <vault> }
```

- **C-1** — the domain binds `verifyingContract` (= the vault address), so a signature is valid on
  exactly one vault (no cross-deployment replay). The off-chain viem signer
  (`packages/nextjs/kredito/attestation.ts`) mirrors this domain.
- **H-1** — the API rejects (and the vault enforces) any window longer than
  `MAX_ATTESTATION_TTL = 30 days`, bounding stale-signature exposure.
- **H-2** — `maxPrincipal` is signed into the attestation (last field); the vault enforces
  `amount ≤ maxPrincipal`. The demo asset is 6-decimal mUSDC where 1 unit == $1, so the recommended
  USD credit limit maps directly to base units.

The vault's `borrow` recovers the signer onchain (`ECDSA`) and requires it equal the issuer; the
borrower cannot forge it. The frontend mirrors this check with `recoverTypedDataAddress` for UX only —
**the contract is the real gate.**

## ENSv2 subname identity + split-ACL resolver

Credit identities are `<label>.kredito.eth` subnames on **ENSv2 / Namechain (Sepolia)**. The parent
`kredito.eth` lives on the `.eth` PermissionedRegistry; its owner delegated subname issuance to a
dedicated UserRegistry (the **subRegistry**) where `KreditoController` holds `ROLE_REGISTRAR`.

`KreditoResolver` serves two record classes with **different write authority**:

- **Issuer-locked keys** — `kredito.status`, `lendsignal.attestation`. Only the resolver's `issuer`
  (the controller) may write them. This is the tamper-evident `approved` / `denied` credential.
- **Profile keys** — `url`, `com.twitter`, `avatar`, `name`, … Only the **subname owner** (the
  business) may write them. Unknown keys default to owner-only, never "anyone".

The business owns its subname token but is **withheld `ROLE_SET_RESOLVER`** (`OWNER_ROLE_BITMAP`), so
it cannot re-point resolution to a resolver it controls and forge `approved`. Cards/readers should pin
the resolver address. Reads flow through the viem/UniversalResolver → `resolve()` (ENSIP-10), which
decodes `addr` / `text` / `addr(coinType 60)` calls keyed by the node.

## Off-chain data model (Supabase)

Project ref **`rooclfwqvmwehaqmtflp`**. **RLS on**, no anon policies → access is **service-role only**
(the app authenticates with Privy, not Supabase Auth, so there's no `auth.uid()`).

| Table | Purpose | Privacy note |
|-------|---------|--------------|
| `credit_checks` | One row per evaluation: combined/AI/bureau scores, risk tier, `eligible`, content hashes (`attestation_hash`, `bureau_report_hash`, `evidence_digest`), Chainlink inference id, profile fields. | The numeric **score is never selected back to the client** — only the eligibility decision + public attestation hash. |
| `ens_identities` | Minted `<label>.kredito.eth` records: label, wallet, node, status, attestation hash, mint tx. | — |
| `ai_config` | Admin-managed model + section/reduce system prompts (falls back to code defaults). | — |
| `profiles` | Business profile metadata. | — |

Raw uploaded documents **never leave the enclave and are never stored** — only their hashes.

## Privy sponsored-smart-wallet write path

Auth is **Privy (email + Google only)**. On login a user gets an embedded EOA signer **and** an
ERC-4337 smart wallet. All gas is sponsored by Privy's **managed paymaster** drawing on dashboard
"App pays" credits.

- **User writes → `useSponsoredWrite()`** (`hooks/scaffold-eth/useSmartWallet.ts`):
  `writeContractSponsored({ address, abi, functionName, args })` for one call, or `sendCalls([...])`
  for an atomic batch (e.g. `approve + repay` in one UserOp).
- **Message signing → `useSmartWalletSign()`** (e.g. the mint-control proof).
- **Reads → `useScaffoldReadContract({ ..., account: useSmartWalletAddress() })`** / `useReadContract`
  pinned to `VAULT_CHAIN_ID`, so balances/positions reflect the smart wallet, not the EOA.
- The **issuer-submitted** writes (`controller.mint`) go through a server-side viem wallet client with
  `ISSUER_PRIVATE_KEY` — these are *not* user UserOps; the user only signs a control-proof message.

> Do **not** use `useScaffoldWriteContract` for user writes — it signs from the embedded EOA and is
> **not** sponsored. See `docs/privy.md`.

## What's deployed vs deferred

| Live on Sepolia | Built, not deployed |
|-----------------|---------------------|
| KreditoController, KreditoResolver, subRegistry, parent `kredito.eth` | KreditoVault (borrow + ERC-4626 + ERC-7540 redeem) |
| Steps 1–3 of the flow (score, attest, mint identity) | Steps 4–5 (borrow, liquidity) — gated on `NEXT_PUBLIC_KREDITO_VAULT` |

Live addresses, deploy commands, and the next-deploy plan: **`docs/deployments.md`**.

## Onchain rules (non-negotiable — from ethskills)

- Say **"onchain"** (one word).
- **0–2 contracts** for an MVP, 3 is the ceiling. Contracts are for ownership/commitments — not a
  database. Everything else lives in Supabase.
- **Verify state before coding.** Live gas, real protocol addresses (`cast code`), token decimals.
- **Decimals kill apps.** USDC = 6 decimals, not 18. The vault's mUSDC is 6-decimal.
- **Never hardcode addresses.** Resolve from a config keyed by chainId. ENS contracts come from
  `NEXT_PUBLIC_KREDITO_CONTROLLER` / `_RESOLVER`; the vault from `NEXT_PUBLIC_KREDITO_VAULT`.
- **Never use spot DEX prices as an oracle.** Use Chainlink feeds.
- **Never commit secrets.** `ISSUER_PRIVATE_KEY` and friends live in env, never in code or chat.
- **Design for incentives, not timers.** ERC-7540 redeem is fulfilled by a keeper as capital frees —
  no function self-executes.
- Invoke **`ethskills:ship`** before writing Solidity, **`ethskills:security`** before deploy,
  `/ship-check` before any onchain deploy.

## Key decisions (ADR-lite)

| Decision | Why |
|----------|-----|
| **Base = Scaffold-ETH 2** | Contract↔frontend hot-reload, typed hooks, local chain/faucet — fastest path. |
| **Wallet = Privy native smart wallets** | Gasless social-login onboarding is core to a lending UX. Native smart wallets use Privy's managed paymaster / dashboard credits; the `@privy-io/wagmi` connector path would need an external ZeroDev/Pimlico paymaster. |
| **Chain = Sepolia** | Privy's bundler + paymaster and ENSv2/Namechain infra run on real testnet, not local anvil. Mainnet is added only for ENS-on-L1 resolution. |
| **Attestation = EIP-712 signature, not a registry** | The issuer signature is the trust anchor; the vault verifies it onchain (recover == issuer). No certificate registry to deploy; ENS carries the identity. |
| **Score off-chain only** | The private credit score is sensitive; it stays in Supabase. Only hashes + the eligibility decision are surfaced, and only the attestation hash goes onchain. |
| **Confidential AI in a TEE** | Raw financial documents must stay private; the Chainlink Confidential AI Attester runs the model inside an AWS Nitro Enclave and returns a cryptographically attested result. |
| **One-key issuer (demo)** | The deployer = `ISSUER_ROLE` = vault issuer = app `ISSUER_PRIVATE_KEY` = `kredito.eth` owner — simple for a hackathon. Prod splits cold admin from hot issuer (see `docs/deployments.md`). |

## Where to go next

- Live addresses + deploy commands → **`docs/deployments.md`**
- EIP-712 attestation detail → `docs/eip-712-attestation.md` · ENS → `docs/ens.md`
- Chainlink Confidential AI → `docs/chainlink.md` · Privy → `docs/privy.md`
- RPC / chains → `docs/rpc.md` · Supabase/Railway → `docs/infra.md`
- Rules & conventions → `CLAUDE.md` · contribution flow → `CONTRIBUTING.md`
