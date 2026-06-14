# LendSignal — onchain credit layer

The credit primitive for **thelender**: turn a business wallet into an updateable onchain
**Credit Certificate** and use it to gate undercollateralized working-capital loans.

Built on the repo's stack (OpenZeppelin v5, forge-std, Scaffold-ETH deploy flow).

## Contracts (2 — within the MVP ceiling)

| Contract | Role |
|----------|------|
| `CreditCertificateRegistry` | Centralizes the offchain credit signals, **defines the per-user score**, enforces the **ENS gate**, and mints the certificate as a **soulbound NFT** (all onchain). |
| `LendingVault` | Holds LP liquidity and issues score-gated undercollateralized loans, with a built-in default-protection reserve. Reads `registry.isEligible`. |

Everything else (documents, KYB, raw bureau reports) stays offchain — only normalized
scores and hashes are published.

## Score (phase 1)

Two signals, blended onchain with owner-tunable weights:

```
combinedScore = confidentialAiScore * 70%  +  bureauScore * 30%
  confidentialAiScore -> Chainlink Confidential AI Attester
  bureauScore         -> offchain CRS credit-risk bureau
```

Risk bands: `>=750 Low`, `600–749 Medium`, `<600 High`. Eligible = active + unexpired +
`score >= minEligibleScore` + tier ≠ High + (ENS gate when enabled).

## ENS gate (real, not cosmetic)

`linkEns(borrower, name, namehash)` attaches an ENS identity; `isEligible` then requires
that the name resolves onchain back to the borrower wallet (and, optionally, that the
`lendsignal.attestation` text record matches the certificate's attestation hash).

> Note: ENS resolution reads **Ethereum mainnet** even when the app runs on Sepolia
> (see root `CLAUDE.md`). Point `setEnsRegistry` at the ENS registry
> `0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e` and `setEnsGateEnabled(true)` to turn it on.

## Soulbound certificate NFT

The registry **is** an ERC-721. Issuing a certificate mints one non-transferable
(ERC-5192) token to the wallet, with fully onchain dynamic SVG art (score, tier, ENS,
status). Transfers/approvals revert; `locked(id) == true`. One token per wallet.

## Layout

```
contracts/lendsignal/
  CreditCertificateRegistry.sol     # contract #1
  LendingVault.sol                  # contract #2
  interfaces/  ICreditCertificateRegistry.sol, IENS.sol
  libraries/   CreditTypes.sol, CreditMetadata.sol (onchain tokenURI)
  mocks/       MockERC20.sol, MockENSRegistry.sol, MockPublicResolver.sol
script/DeployLendSignal.s.sol       # deploys registry + vault (+ mUSDC); registered in Deploy.s.sol
test/lendsignal/                    # 30 forge-std tests
```

## Run

```bash
# from packages/foundry
forge test --match-path "test/lendsignal/*"   # 30 tests

# from repo root (Scaffold-ETH): deploys + exports ABIs to packages/nextjs
yarn deploy --file DeployLendSignal.s.sol
```

After deploy, SE-2 auto-generates ABIs/addresses into
`packages/nextjs/contracts/deployedContracts.ts` — wire the UI with the typed
`useScaffoldReadContract` / `useSponsoredWrite` hooks.

## Issuer model

`owner` (admin) tunes weights, the eligibility floor and the ENS gate. `issuer` (the
backend / Chainlink CRE signer) is the only address that can `issueCertificate`,
`updateCertificate` and `linkEns`. `DeployLendSignal` sets the deployer as the issuer for
the demo.

## Next steps

- Frontend pages for onboarding → score → certificate → borrow (SE-2 + Privy sponsored writes).
- Offchain service to call Chainlink Confidential AI + the CRS bureau and feed `ScoreInputs`.
- Optionally let the vault flag the certificate on default (grant it the issuer role).
