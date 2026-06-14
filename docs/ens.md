# ENS Integration Notes — Kredito credit identities

Kredito issues **`<label>.kredito.eth` ENSv2 (Namechain) subnames on Sepolia** as on-chain credit
identities. Each name *is* the certificate: an issuer-locked `kredito.status` record carries the
`approved` / `denied` decision, the business edits its own profile records, and the private credit
score never goes on-chain (it stays in Supabase). There is **no separate soulbound NFT** — the ENSv2
subname (an ERC-1155 token in the parent registry) is the credential.

Ground new code with **"use context7 for ensdomains/docs"**.

> This is **ENSv2** (the new hierarchical, ERC-1155 registry system), not legacy ENS, and it is
> separate from normal `.eth` name lookups. The two bespoke contracts (`KreditoController`,
> `KreditoResolver`) live in `packages/foundry/contracts/kredito/`.

## Why ENSv2 names ARE the certificate

A `<label>.kredito.eth` subname is an ERC-1155 token registered in `kredito.eth`'s subregistry. The
business owns that token, but Kredito's resolver enforces a **split write-ACL** so the credit
decision can't be forged by the owner:

- **Issuer-locked keys** — `kredito.status` and `lendsignal.attestation`. Only the issuer
  (`KreditoController`) may write them. This is the tamper-evident "approved/denied" credential.
- **Owner-editable profile keys** — `name`, `url`, `com.twitter`, `avatar`, `header`, `email`,
  `location`, `com.github`, `org.telegram`, `com.discord`, `com.linkedin`. Only the subname owner may
  write them (`setText` / batched `setTexts`).

Security pin: the business is **not** granted `ROLE_SET_RESOLVER` on its subname (see
`KreditoEnsRoles.OWNER_ROLE_BITMAP`), so it cannot re-point resolution at a resolver it controls and
fake `approved`. The credit card UI should also pin reads to the `KreditoResolver` address.

This is why no extra NFT is needed: ownership, profile, and the locked credential all ride on the one
ENSv2 token + resolver records.

## Split-ACL resolver — `KreditoResolver`

`packages/foundry/contracts/kredito/KreditoResolver.sol`:

- Implements **ENSIP-10** `resolve(name, data)` (advertises `IExtendedResolver` interface id
  `0x9061b923`) plus `addr(bytes32)`, `addr(bytes32,uint256)`, and `text(bytes32,string)`. Reads go
  through the ENSv2 UniversalResolver, which calls `resolve()` after the interface check; the inner
  call carries the namehash `node`, and every record is keyed by that `node`.
- `initIdentity(node, owner, status, attestation)` — issuer-only, called once at mint: binds the
  node to its owner, sets `addr`, and writes the locked `kredito.status` / `lendsignal.attestation`.
- `setStatus(node, status)` — issuer-only (e.g. revoke-on-default → `denied`). No burn; the business
  keeps the name.
- `setText` / `setTexts` — per-key ACL: locked keys require the issuer, everything else requires the
  owner, unknown keys default to owner-only. A non-issuer can't smuggle a locked key into a batch.
- `admin` can rotate the `issuer` address (cold key in prod).

## Issuance — `KreditoController`

`packages/foundry/contracts/kredito/KreditoController.sol` is the issuance authority. It holds
`ROLE_REGISTRAR` on `kredito.eth`'s subregistry (the only thing that can create subnames) and is the
`issuer` of `KreditoResolver`.

- `mint(label, business, attestationHash)` — `ISSUER_ROLE`-gated. Registers `<label>.kredito.eth` to
  the business in the subregistry, then calls `resolver.initIdentity(...)` stamping `approved` + the
  attestation hash. There is **no user-relayed voucher**: holding `ISSUER_ROLE` is the authorization,
  and the gas-sponsored backend submits the tx. `issued[node]` makes mint idempotent.
- `revoke(label)` / `setStatus(label, status)` — issuer-only status flips.
- `DEFAULT_ADMIN_ROLE` (cold key / multisig in prod) rotates the hot `ISSUER_ROLE` key and tunes
  config (`setResolver`, `setSubRegistry`, `setParentNode`, `setDefaultExpiry`, `setOwnerRoleBitmap`).
- `nodeOf(label)` = `keccak256(parentNode, keccak256(label))` — the standard ENS namehash of
  `<label>.kredito.eth`.

## Mint flow (frontend → backend)

1. The business signs the **mint challenge** with its Privy smart wallet —
   `mintMessage(wallet, normalizedLabel)` from `packages/nextjs/lib/kredito.ts` (off-chain, free; see
   `useSmartWalletSign`). The message binds the wallet AND the ENSIP-15-normalized label.
2. Frontend `POST`s `{ wallet, label, profile, signature }` to
   `packages/nextjs/app/api/identity/mint/route.ts`.
3. The route `verifyMessage`s the signature (EOA + ERC-1271/6492 smart-wallet aware), confirms the
   wallet's Supabase decision is `approved`, checks the label is free, then signs the `mint` tx with
   `ISSUER_PRIVATE_KEY` against `NEXT_PUBLIC_KREDITO_CONTROLLER` and waits for the receipt. The label
   is normalized with `normalizeLabel` (ENSIP-15) before anything else.
4. The identity is mirrored into Supabase (`insertIdentity`) with the node, tx hash, and attestation
   hash. In the subsequent **Profile** step the owner customizes their public records (display name,
   about, avatar, banner, website, email, location, X / GitHub / Telegram / Discord / LinkedIn); these
   are sanitized (`sanitizeProfile`), written on-chain via the owner-gated, gas-sponsored
   `resolver.setTexts` batch, and mirrored back to `ens_identities` for fast card rendering.

## Public verification

The `<label>.kredito.eth` subname **is** the credit credential — anyone can verify it without trusting
Kredito, because the `kredito.status` record is issuer-locked. The app surfaces this two ways:

- **`/identity/<label>`** — a public verified card for a single identity (name, profile, locked
  approved status + attestation hash).
- **`/verify`** — a lookup page (linked as **"Verify"** in the header) to find any identity by label.

The minted identity (name + avatar) is also surfaced app-wide via a header chip
(`useKreditoIdentity` / `IdentityChip`). This is **Kredito's ENSv2 identity**, separate and unrelated
to ordinary mainnet `.eth` resolution below.

> The legacy "publish the attestation to your own ENS name" model (`verifyPublished` / a standalone
> `/ens-page`) has been **removed** — the `<label>.kredito.eth` subname + the `/identity` and `/verify`
> pages are the only verification surface.

## Live Sepolia addresses (chainId 11155111)

| What | Address |
|------|---------|
| `KreditoController` (`NEXT_PUBLIC_KREDITO_CONTROLLER`) | `0xE498cbC0F0ED0b9059FEc2a7F1275834108915B0` |
| `KreditoResolver` (`NEXT_PUBLIC_KREDITO_RESOLVER`) | `0xE68F49F6256a2aF1702855dc62B82afF6Fd65F0E` |
| `kredito.eth` subregistry (`UserRegistry` proxy) | `0x2167d6DF85bC76f22b7f150220740444DC257AAf` |
| `.eth` registry (`PermissionedRegistry`) | `0xDEDB92913A25abE1f7BCDD85D8A344a43B398B67` |
| `kredito.eth` namehash | `0x9481555486db711081424d25f193ca60bb54f9b6e9a7c4032fac5abc95270580` |
| Issuer / owner / deployer (one key, demo; prod splits cold admin from hot issuer) | `0x4B24116Df4C31c40aB5B3cb3bA3Ffe743A346978` |

The contracts are wired to the frontend via `NEXT_PUBLIC_KREDITO_CONTROLLER` /
`NEXT_PUBLIC_KREDITO_RESOLVER`. Shared helpers (namehash, label normalization, profile field map,
minimal ABIs) live in `packages/nextjs/lib/kredito.ts`.

## Normal ENS name resolution (mainnet)

Separate from the Kredito ENSv2 identities above, ordinary ENS name/avatar lookups in the app (e.g.
the connect button) **always read from Ethereum Mainnet** (chainId 1) via a dedicated mainnet viem
client, even though the app runs on Sepolia. Mainnet is always present in `supportedChains` /
`enabledChains` for exactly this reason.

```ts
import { normalize } from 'viem/ens'

const addr   = await mainnetClient.getEnsAddress({ name: normalize('alice.eth') })
const name   = await mainnetClient.getEnsName({ address })       // then verify it forward-resolves back
const avatar = await mainnetClient.getEnsAvatar({ name: normalize(name) })
```

- **Always `normalize()`** user-supplied names before resolving (ENSIP-15).
- **Verify reverse records**: after `getEnsName`, call `getEnsAddress` on the result and confirm it
  matches before treating it as trusted.
- **wagmi** hooks (`useEnsName`, `useEnsAvatar`, `useEnsAddress`) — set `chainId: mainnet.id`.
- Cache via wagmi/react-query — resolution is an RPC round-trip.
