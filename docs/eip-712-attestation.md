# Kredito — EIP-712 credit attestation

Kredito gates borrowing with an **issuer-signed [EIP-712](https://eips.ethereum.org/EIPS/eip-712)
credit attestation** rather than an on-chain certificate registry. The Confidential-AI score is
turned into a typed, signed credential; `KreditoVault.borrow` verifies that signature on-chain
(recovering the signer and requiring `signer == issuer`) before disbursing USDC.

## Why EIP-712

EIP-712 is the standard for **typed, structured-data signing** — wallets render a human-readable
struct, and the signature is bound to a typed domain. It lets the protocol issue a verifiable credit
credential with **no registry contract and no per-borrower on-chain write**: the issuer signs
off-chain (server-side), and the vault verifies on-chain at borrow time.

## One issuer key, two jobs

The same `ISSUER_PRIVATE_KEY` that signs attestations also holds the `ISSUER_ROLE` on
`KreditoController` (the ENSv2 minting authority — see `docs/ens.md`). One signer therefore both
mints the `<label>.kredito.eth` identity and signs the borrow credential. In the demo this is a
single key (`0x4B24116Df4C31c40aB5B3cb3bA3Ffe743A346978`); production splits a cold admin from a
hardened hot issuer (multisig / HSM).

## The attestation

The issuer signs this struct. The TypeScript domain/types in
`packages/nextjs/kredito/attestation.ts` mirror `KreditoVault.sol`'s `CREDIT_ATTESTATION_TYPEHASH`
and `EIP712_DOMAIN_TYPEHASH` byte-for-byte:

```
domain = {
  name:              "Kredito"
  version:           "1"
  chainId:           11155111            // Sepolia
  verifyingContract: <KreditoVault addr> // C-1: signature valid only on THIS vault
}

CreditAttestation {
  borrower:       address
  score:          uint256   // 0–1000 (clamped server-side)
  riskTier:       uint8     // 0 = high, 1 = medium, 2 = low
  evidenceDigest: bytes32
  issuedAt:       uint256
  expiresAt:      uint256
  maxPrincipal:   uint256   // H-2: issuer-bound max loan size, in asset units (USDC = 6 decimals)
}
```

Two hardening properties bound into the signature:

- **C-1 — `verifyingContract` in the domain.** The signature is valid only on the one deployed vault
  (`address(this)`), killing cross-deployment replay. The signer must therefore know the vault
  address; `attestationDomain(vault)` / `typedData(att, vault)` take it as a parameter rather than
  using a constant domain.
- **H-2 — `maxPrincipal`.** Appended as the LAST field (so prior fields hash identically). The issuer
  binds the maximum loan size into the signature itself, and `borrow` enforces
  `amount <= maxPrincipal`. There is **no user-entered loan amount**: the credit limit is **derived
  from the score** by `creditLimitUsd` (`packages/nextjs/lib/kredito.ts`) and converted to asset base
  units (6-decimal mUSDC, 1 unit == $1) when the attestation is signed.
- **H-1 — bounded lifetime.** The vault rejects any window longer than `MAX_ATTESTATION_TTL`
  (30 days); the signing route mirrors this as `MAX_ATTESTATION_TTL_SECONDS` and rejects out-of-range
  `expiresAt` early.

## Flow

```
score pipeline (Confidential AI, see docs/chainlink.md)
        │
        ▼
POST /api/lendsignal/attest      (server, ISSUER_PRIVATE_KEY — never reaches the client)
        │  validates borrower/score/evidenceDigest/expiresAt/maxPrincipal,
        │  stamps issuedAt = now, enforces the TTL window,
        │  account.signTypedData(typedData(att, KREDITO_VAULT_ADDRESS))
        ▼
{ attestation, signature, issuer, digest }   (maxPrincipal serialized as a base-10 string)
        │
        ▼
KreditoVault.borrow(att, sig, amount)   — borrower relays it; the vault:
        recoverIssuer(att, sig) == issuer   (isEligible)
        att.score >= minScore (currently 600), riskTier != 0 (not high risk)
        _assertFreshness (issued ≤ now < expiry, window ≤ MAX_ATTESTATION_TTL)
        amount <= att.maxPrincipal, amount <= idleLiquidity(), no open loan
        burns the attestation (attestationUsed[digest]) → one-time use, then disburses asset
```

- **Issuer = signer = vault `issuer`.** `recoverIssuer` recovers the signer from the EIP-712 digest;
  a genuine attestation is one whose signer equals the configured `issuer`.
- **One-time use.** The vault marks `attestationUsed[hashAttestation(att)]`, so a signature can't be
  replayed for a second loan.
- **No certificate NFT / registry** — the signed credential is the trust anchor; ENS carries the
  discoverable identity.

## Related contracts / files

- `packages/foundry/contracts/lendsignal/KreditoVault.sol` — ERC-4626 + ERC-7540 async-redeem vault
  that verifies the EIP-712 signature and gates `borrow`. **Built (87 tests) and deployed on Sepolia
  at `0xd09ecaa42eeb68c5a638d7556c41d62c38dbe5cc`** (via `script/DeployKreditoFullStack.s.sol`); it
  supersedes the earlier `KreditoCreditVault.sol`. `NEXT_PUBLIC_KREDITO_VAULT` is set to its address
  so the attest route binds the domain.
- `packages/nextjs/kredito/attestation.ts` — domain / types / struct + `typedData` helper
  (client-safe; mirrors the contract).
- `packages/nextjs/app/api/lendsignal/attest/route.ts` — issuer signing endpoint (`nodejs` runtime).
- `packages/nextjs/kredito/vault.ts` — `KREDITO_VAULT_ADDRESS` + borrow-side ABI/helpers.

## Status

Borrow (vault) and the LP liquidity side are **LIVE on Sepolia** — the vault is deployed at
`0xd09ecaa42eeb68c5a638d7556c41d62c38dbe5cc`, so `/api/lendsignal/attest` binds the domain to it and
signs real borrow credentials. The vault is **unseeded**, so an LP must supply USDC (via the app's
Liquidity step) before a borrow can actually disburse. The scoring → identity-mint path (which
reuses the same issuer key) is live on Sepolia too.
