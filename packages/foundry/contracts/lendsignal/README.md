# Kredito — onchain credit layer (Option B: issuer-signed attestation)

Turn a business wallet into a creditworthy identity and use it to gate undercollateralized
working-capital loans — **without a bespoke certificate registry**. The trust anchor is an
**issuer-signed EIP-712 attestation**; a vault verifies it onchain. **ENS provides the
identity** (the `.eth` name is itself the NFT).

Built on the repo's stack (OpenZeppelin v5, forge-std, Scaffold-ETH deploy flow).

## Why Option B

ENS text records are written by the **name owner** (the business), so they can't be the
source of truth for a loan — the borrower could set any score. Instead, the **protocol
(issuer) signs** the score off-chain; the borrower can't forge that signature. The vault
recovers the signer onchain and checks it equals the issuer. No registry write, no
soulbound NFT contract — ENS carries the identity, the signature carries the trust.

## Contract

| Contract | Role |
|----------|------|
| `KreditoCreditVault` | Verifies an EIP-712 `CreditAttestation` signed by the `issuer`, then gates `borrow()` on `recover == issuer` + `score >= minScore` + not expired + tier ≠ High. Holds LP liquidity; replay guard (each attestation usable once) + one open loan per borrower. |

Everything else (documents, KYB, raw bureau reports) stays offchain — only the score and
content hashes are attested.

## The attestation (EIP-712)

```
Domain:  EIP712Domain(string name,string version,uint256 chainId)   // name "Kredito", version "1" — NO verifyingContract
Struct:  CreditAttestation(address borrower,uint256 score,uint8 riskTier,bytes32 evidenceDigest,uint256 issuedAt,uint256 expiresAt)
         riskTier: 0 = high, 1 = medium, 2 = low
```

The domain omits `verifyingContract` (chainId-bound only) so the issuer can sign before the
vault address exists. The frontend signer (`packages/nextjs/kredito/attestation.ts` +
`/api/lendsignal/attest`) uses these exact strings, byte-for-byte.

Score (computed off-chain, carried in the attestation):
`combinedScore = confidentialAiScore·70% + bureauScore·30%` · bands `≥750 Low / 600–749 Medium / <600 High`.

## ENS (identity, not a contract gate)

The business's ENS name is its credit identity (and an ERC-721/ERC-1155 NFT). Publish
pointers as text records (`lendsignal.attestation`, `lendsignal.risk-tier`, agent records
per ENSIP-25/26). ENS resolution reads **Ethereum mainnet** even on Sepolia (see root
`CLAUDE.md`).

## Layout

```
contracts/lendsignal/
  KreditoCreditVault.sol            # EIP-712 attestation verifier + lending vault
  mocks/MockERC20.sol               # demo asset (mUSDC, 6 decimals)
script/DeployKreditoVault.s.sol     # deploys vault (+ mUSDC, seeded liquidity); registered in Deploy.s.sol
test/lendsignal/KreditoCreditVault.t.sol   # 23 forge-std tests (incl. tamper/expiry/replay/fuzz)
```

## Run

```bash
# from packages/foundry
forge test --match-path "test/lendsignal/*"          # 23 tests

# from repo root (Scaffold-ETH): deploys + exports ABIs to packages/nextjs
yarn deploy --file DeployKreditoVault.s.sol --network sepolia
```

After deploy, set `ISSUER_PRIVATE_KEY` (the signer, **= the deployer/issuer**) and
`NEXT_PUBLIC_KREDITO_VAULT` in `packages/nextjs/.env`. SE-2 auto-generates ABIs/addresses
into `packages/nextjs/contracts/deployedContracts.ts`.

## Issuer model

`owner` (admin) tunes `minScore` and can rotate `issuer`. `issuer` is the only key whose
signature the vault accepts. `DeployKreditoVault` sets the deployer as `issuer`, so the
demo signing key (`ISSUER_PRIVATE_KEY`) must be the deployer.

## Next steps

- Wire the **Borrow** step to call `vault.borrow(attestation, signature)` (the Certificate
  step already produces + verifies the signed attestation).
- Add `verifyingContract` to the EIP-712 domain once the vault address is fixed (tighter binding).
