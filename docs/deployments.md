# Kredito — Deployment registry (Ethereum Sepolia)

Live onchain addresses, the roles they hold, deploy commands, and env mapping. **Sepolia only**
(chainId `11155111`). Source of truth for "what's deployed" — pair with `docs/architecture.md`.

> Blockscout links use `https://eth-sepolia.blockscout.com/address/<addr>`.
> No secrets here: only public addresses. The issuer **address** `0x4B24…6978` is public; its
> **private key** lives in env (`ISSUER_PRIVATE_KEY`) and never in code, docs, or chat.

## Kredito contracts (LIVE)

| Contract | Address | Role | Explorer |
|----------|---------|------|----------|
| **KreditoController** | `0xE498cbC0F0ED0b9059FEc2a7F1275834108915B0` | Issuance authority. Holds `ROLE_REGISTRAR` on the subRegistry; mints `<label>.kredito.eth` (onlyRole `ISSUER_ROLE`). | [↗](https://eth-sepolia.blockscout.com/address/0xE498cbC0F0ED0b9059FEc2a7F1275834108915B0) |
| **KreditoResolver** | `0xE68F49F6256a2aF1702855dc62B82afF6Fd65F0E` | ENSv2 split-ACL resolver (ENSIP-10). Issuer = the controller. | [↗](https://eth-sepolia.blockscout.com/address/0xE68F49F6256a2aF1702855dc62B82afF6Fd65F0E) |
| **subRegistry** | `0x2167d6DF85bC76f22b7f150220740444DC257AAf` | Our ENSv2 UserRegistry proxy under `kredito.eth`. Controller holds `ROLE_REGISTRAR`; deployer is root admin. | [↗](https://eth-sepolia.blockscout.com/address/0x2167d6DF85bC76f22b7f150220740444DC257AAf) |
| **KreditoVault** | *not deployed* | ERC-4626 + EIP-712 attestation-gated lender + ERC-7540 async redeem. Built (87 tests). See "To deploy next". | — |

## ENSv2 / Namechain infra (external, Sepolia)

| Thing | Value | Notes |
|-------|-------|-------|
| **`.eth` PermissionedRegistry** | `0xDEDB92913A25abE1f7BCDD85D8A344a43B398B67` | Parent registry; the `kredito.eth` owner holds `ROLE_SET_SUBREGISTRY` here. [↗](https://eth-sepolia.blockscout.com/address/0xDEDB92913A25abE1f7BCDD85D8A344a43B398B67) |
| **VerifiableFactory** | `0xD2a632D8a8b67c2c4398c255CbD7aF8dd7236198` | Deploys the UserRegistry proxy (our subRegistry). |
| **UserRegistry impl** | `0x0F99e7Ea74903AfCB7224d0354fD7428A6f92917` | Implementation behind the subRegistry proxy. |
| **parent `kredito.eth`** | namehash `0x9481555486db711081424d25f193ca60bb54f9b6e9a7c4032fac5abc95270580` | labelhash("kredito") `0x4e183bf135dc944da7caf82858041eccc41c8c95229113d91f3eae6234ee1ef4`. |

## The setSubregistry wiring tx (manual, owner-signed)

The setup script cannot wire the subRegistry under `kredito.eth` — only the parent owner holds
`ROLE_SET_SUBREGISTRY`. That single transaction, sent by the `kredito.eth` owner to the `.eth`
PermissionedRegistry (`setSubregistry(labelhash("kredito"), subRegistry)`), was executed at:

```
0xa289848fb1c99d09fe5351023abf11da8b73cd52cb4bd2ddc569ef8c0736945d
```

[View on Blockscout ↗](https://eth-sepolia.blockscout.com/tx/0xa289848fb1c99d09fe5351023abf11da8b73cd52cb4bd2ddc569ef8c0736945d)

After this, the controller's `ROLE_REGISTRAR` on the subRegistry actually resolves under
`*.kredito.eth`, so mints are live.

## The one-key issuer model (demo posture)

For the hackathon, a single key wears every hat:

| Hat | Where it's used |
|-----|-----------------|
| **deployer** | runs `SetupKreditoEns.s.sol` (Foundry `--account kredito-issuer`) |
| **`DEFAULT_ADMIN_ROLE`** | cold admin on `KreditoController` (rotates issuer, tunes config) |
| **`ISSUER_ROLE`** | hot key that calls `controller.mint` |
| **vault issuer** | will sign EIP-712 `CreditAttestation`s for `KreditoVault` |
| **app `ISSUER_PRIVATE_KEY`** | server signs attestations + submits `controller.mint` |
| **`kredito.eth` owner** | signed the `setSubregistry` tx above |

Address: **`0x4B24116Df4C31c40aB5B3cb3bA3Ffe743A346978`**
[↗](https://eth-sepolia.blockscout.com/address/0x4B24116Df4C31c40aB5B3cb3bA3Ffe743A346978)

### Rotating to split roles for prod

The contracts already separate the roles; only the key assignment is collapsed for the demo. To
harden:

1. **Cold admin / hot issuer split.** Put `DEFAULT_ADMIN_ROLE` on a multisig (cold). Give a separate
   hot backend key `ISSUER_ROLE`:
   `controller.grantRole(ISSUER_ROLE, <hotKey>)` then `controller.revokeRole(ISSUER_ROLE, <deployer>)`.
2. **Resolver issuer follows.** The resolver's writer is the controller, so nothing to rotate there —
   but if you ever change the controller, call `resolver.setIssuer(<newController>)` from the resolver
   `admin` (cold).
3. **Vault issuer.** Deploy `KreditoVault` with the hot issuer as its attestation signer; set the app's
   `ISSUER_PRIVATE_KEY` to that same hot key. Keep it off the admin/owner keys.
4. **kredito.eth owner.** Keep the parent-name owner on the cold multisig; it's only needed for
   re-wiring `setSubregistry`, which is rare.

If the hot issuer leaks: rotate it onchain via `grantRole`/`revokeRole` (admin) and replace
`ISSUER_PRIVATE_KEY`. The cold admin and `kredito.eth` owner are untouched.

## Deploy commands

### ENS issuance stack (deployed)

```bash
# 1. SIMULATE first (no broadcast) — proves the unverified ENSv2 infra calls don't revert.
forge script script/SetupKreditoEns.s.sol --rpc-url sepolia --account kredito-issuer --ffi

# 2. BROADCAST — deploys controller + resolver + subRegistry, grants ROLE_REGISTRAR to the
#    controller, and PRINTS the setSubregistry tx for the kredito.eth owner to sign.
forge script script/SetupKreditoEns.s.sol --rpc-url sepolia --account kredito-issuer --broadcast --ffi
```

What the script does (run by the deployer; needs no `kredito.eth` owner key):

1. deploys the subRegistry (a stock ENSv2 UserRegistry proxy via VerifiableFactory) with the deployer
   as root admin (`ROLE_REGISTRAR | ROLE_REGISTRAR_ADMIN`);
2. deploys `KreditoController` + `KreditoResolver` and wires them (`setResolver`, `setSubRegistry`);
3. grants the controller `ROLE_REGISTRAR` on the subRegistry;
4. prints the single `setSubregistry(labelhash("kredito"), subRegistry)` calldata for the
   `kredito.eth` owner to send to the `.eth` PermissionedRegistry (done — tx above).

> SE-2 exports `KreditoController` + `KreditoResolver` ABIs for tooling, but the ENS contracts are
> consumed in the app via env (`NEXT_PUBLIC_KREDITO_CONTROLLER` / `_RESOLVER`), **not** through
> `deployedContracts.ts`.

## Env → address mapping

| Env var | Maps to | Used by |
|---------|---------|---------|
| `NEXT_PUBLIC_KREDITO_CONTROLLER` | `0xE498…15B0` (KreditoController) | `/api/identity/mint` (issuer submits `mint`) |
| `NEXT_PUBLIC_KREDITO_RESOLVER` | `0xE68F…5F0E` (KreditoResolver) | ENS reads / identity lookup |
| `NEXT_PUBLIC_KREDITO_VAULT` | *(unset — vault not deployed)* | borrow/liquidity steps + `/api/lendsignal/attest` (`verifyingContract`) |
| `ISSUER_PRIVATE_KEY` | private key for `0x4B24…6978` | server-side: signs EIP-712 attestations, submits `controller.mint`. **Secret — env only.** |
| `KREDITO_ISSUER` | issuer address (defaults to deployer) | `SetupKreditoEns.s.sol` (`ISSUER_ROLE` grant) |
| `ALCHEMY_API_KEY` / `NEXT_PUBLIC_ALCHEMY_API_KEY` | Sepolia RPC | server clients (falls back to publicnode) |
| `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | Supabase ref `rooclfwqvmwehaqmtflp` | `credit_checks` / `ens_identities` persistence |
| `CHAINLINK_CONFIDENTIAL_AI_API_KEY` (+ `_BASE_URL`) | Confidential AI Attester | `/api/lendsignal/score`; unset → deterministic mock (`attested:false`) |

## To deploy next: KreditoVault

`packages/foundry/contracts/lendsignal/KreditoVault.sol` is built and tested (87 tests) but **not yet
deployed**. Until it is, the Borrow + Liquidity steps render a "Vault not configured" panel.

Deploy scripts exist: `script/DeployKreditoVault.s.sol` and `script/DeployKreditoVaultV2.s.sol`
(V2 resolves the USDC asset by chainId).

```bash
# Deploy + verify the vault on Sepolia (resolves USDC by chainId).
forge script script/DeployKreditoVaultV2.s.sol --rpc-url sepolia --account kredito-issuer --broadcast --verify
# (or via SE-2 wrapper)
yarn deploy --file DeployKreditoVaultV2.s.sol --network sepolia
```

Post-deploy checklist:

1. **Set `NEXT_PUBLIC_KREDITO_VAULT`** to the deployed vault address (frontend + Vercel env). This
   unlocks the borrow/liquidity steps **and** is the `verifyingContract` the attestation signer binds
   (C-1) — `/api/lendsignal/attest` returns `vault_not_configured` until it's set.
2. **Confirm the issuer.** The vault's attestation signer must equal `ISSUER_PRIVATE_KEY`'s address
   (`0x4B24…6978` in the demo).
3. **Verify decimals.** Asset is 6-decimal mUSDC (1 unit == $1 in the demo); `maxPrincipal` is in base
   units.
4. **Seed liquidity.** LPs `deposit` mUSDC so `idleLiquidity()` can cover borrows.
5. **Record it here** — add the address + Blockscout link to the table at the top and flip its status
   to LIVE.

Add the address to this registry once live:

```
| **KreditoVault** | `0x…` | ERC-4626 + attestation-gated lender + ERC-7540 redeem | [↗](https://eth-sepolia.blockscout.com/address/0x…) |
```
