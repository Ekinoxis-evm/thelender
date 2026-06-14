# Kreditos — EIP-712 credit attestation ("Option B")

Kreditos gates lending with an **issuer-signed [EIP-712](https://eips.ethereum.org/EIPS/eip-712) credit attestation** instead of an onchain certificate registry. ENS provides identity/discovery; the signature provides trust; the vault verifies it onchain.

## Why EIP-712
[EIP-712](https://eips.ethereum.org/EIPS/eip-712) is the standard for **typed, structured data signing** — wallets render a human-readable struct instead of an opaque hash, and the signature is bound to a typed domain. It lets the protocol issue a portable, verifiable credit credential with **no registry contract and no per-borrower onchain write**: the issuer signs offchain, anyone verifies onchain or offchain.

## The attestation
The issuer signs this struct (`kredito/attestation.ts`, must match `KreditoCreditVault.sol` byte-for-byte):

```
domain  = { name: "Kredito", version: "1", chainId: 11155111 }   // NO verifyingContract — chainId-bound only
types   = CreditAttestation {
  borrower:       address
  score:          uint256
  riskTier:       uint8     // 0 = high, 1 = medium, 2 = low
  evidenceDigest: bytes32
  issuedAt:       uint256
  expiresAt:      uint256
}
```

Omitting `verifyingContract` from the domain makes the signature **portable** — the signer doesn't need the deployed vault address, and the same attestation works across vault deployments on the same chain.

## Flow
```
score pipeline (Confidential-AI) ─▶ POST /api/lendsignal/attest
        issuer signs the CreditAttestation (server-side, ISSUER_PRIVATE_KEY)
                                   │
        ┌──────────────────────────┴───────────────────────────┐
        ▼                                                        ▼
  ENS (Sepolia): publish as text records on the business's       KreditoCreditVault.borrow(att, sig, amount)
  ENS name — kredito.attestation / kredito.score / kredito.risk  recovers the signer onchain, requires
  → anyone resolves + verifies the issuer signature              signer == issuer, then lends
```

- **Issuer = signer = vault `issuer`** (the deployer). `ISSUER_PRIVATE_KEY` signs; it MUST equal the vault's configured issuer.
- **Identity:** the business publishes the attestation as ENS text records (`kredito.attestation`, `kredito.score`, `kredito.risk`) on its own ENS name; resolution + signature-verification is permissionless.
- **No certificate NFT / registry** — dropped in favour of this signed-credential model.

## Related contracts / files
- `packages/foundry/contracts/lendsignal/KreditoCreditVault.sol` — verifies the EIP-712 signature, gates `borrow`.
- `packages/nextjs/kredito/attestation.ts` — domain/types/struct (client-safe; mirrors the contract).
- `packages/nextjs/kredito/ens.ts` — publish/read/verify the attestation on ENS (Sepolia).
- `packages/nextjs/app/api/lendsignal/attest/route.ts` — issuer signing endpoint.

## Roadmap
- The vault is being upgraded to an **[EIP-7540](https://eips.ethereum.org/EIPS/eip-7540) asynchronous ERC-4626 vault** (async deposit/redeem for the p2p funding pools) on a separate branch.
- A richer ENSv2 **subname-issuance** identity layer (`<biz>.kredito.eth` via a custom controller/resolver, with editable profiles) is prototyped on `feat/ens-subnames` as a future enhancement on top of this attestation model.
