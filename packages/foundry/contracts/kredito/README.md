# KreditoOne — ENSv2 credit identity

Issues `<business>.kredito.eth` **ENSv2 (Namechain) subnames on Sepolia** as on-chain credit
identities. Only businesses the CRE / Confidential-AI-Attester flow has **approved** get one; the
`approved/denied` status is an **issuer-locked** record; the business edits its own profile
(website, X, avatar); the private **credit score stays off-chain in Supabase**.

> This is **ENSv2** (the new hierarchical, ERC-1155 registry system), *not* legacy ENS. It is
> deliberately isolated from the legacy `lendsignal` contracts. Built off `main` on
> `feat/ens-subnames`; reconciled with the lending/CRE branches at merge.

## Contracts (2 bespoke)

| Contract | Role |
|----------|------|
| `KreditoController` | Issuance authority. Holds `ROLE_REGISTRAR` on kredito.eth's subregistry. The backend `ISSUER_ROLE` calls `mint(label, business, attestationHash)` directly (no voucher) → `register()` + stamps the locked records. `revoke()` flips status to `denied`. Cold `DEFAULT_ADMIN_ROLE` rotates the hot issuer key. |
| `KreditoResolver` | The ENSv2 resolver for issued names. Implements ENSIP-10 `resolve()` (+ ERC-165 `0x9061b923`). Split write-ACL: `kredito.status` / `lendsignal.attestation` = **issuer-only**; `url` / `com.twitter` / `avatar` / `name` = **owner-only**. |

`interfaces/IEnsV2.sol` holds the minimal, on-chain-verified ENSv2 slices + role constants — we do
**not** vendor the pre-audit `ensdomains/contracts-v2` source.

## Verified ENSv2 Sepolia infra (chainId 11155111)

| What | Address |
|------|---------|
| `.eth` registry (`PermissionedRegistry`) | `0xDEDB92913A25abE1f7BCDD85D8A344a43B398B67` |
| `VerifiableFactory` | `0xD2a632D8a8b67c2c4398c255CbD7aF8dd7236198` |
| `UserRegistry` impl | `0x0F99e7Ea74903AfCB7224d0354fD7428A6f92917` |
| `kredito.eth` namehash | `0x9481555486db711081424d25f193ca60bb54f9b6e9a7c4032fac5abc95270580` |
| `kredito.eth` owner (signs `setSubregistry`) | `0x4b24116df4c31c40ab5b3cb3ba3ffe743a346978` |

> The factory + UserRegistry impl are live (created by the ENSv2 deployer, matched to the official
> repo deploy artifacts) but **not Blockscout-source-verified** — always run the **simulation first**.

## Deploy (Sepolia)

The deployer key lives in **your** `packages/foundry/.env` (gitignored) — never shared. Optional
`KREDITO_ISSUER` env sets the backend hot key (defaults to the deployer for the demo).

```bash
# 1. SIMULATE first (this is the dry-run that proves the unverified ENSv2 calls don't revert)
yarn deploy --file SetupKreditoEns.s.sol

# 2. Broadcast
yarn deploy --file SetupKreditoEns.s.sol --broadcast
```

The script deploys our `UserRegistry` proxy + `KreditoController` + `KreditoResolver`, wires them,
grants the controller `ROLE_REGISTRAR`, and **prints the one transaction the `kredito.eth` owner must
sign** to attach our registry:

```
to:   0xDEDB92913A25abE1f7BCDD85D8A344a43B398B67
data: setSubregistry(labelhash("kredito"), <our UserRegistry>)
# signed by 0x4b24116df4c31c40ab5b3cb3ba3ffe743a346978, e.g.:
cast send <to> <data> --account <kredito-owner>
```

After that one owner tx, `<label>.kredito.eth` resolves through `KreditoResolver`, and the backend
(`ISSUER_ROLE`) can `mint` approved businesses.

## Tests

```bash
forge test --match-path "test/kredito/*"   # 19 tests
```

Covers `resolve()` ABI correctness (what viem/UniversalResolver decodes), the split ACL
(issuer-locked vs owner-editable), the security pin (owner role bitmap excludes `ROLE_SET_RESOLVER`,
so a business can't re-point its resolver and forge `approved`), idempotent mint, revoke, and issuer
rotation.
