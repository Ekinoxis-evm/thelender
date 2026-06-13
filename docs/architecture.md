# thelender — Architecture & Decisions

How the pieces fit, and **why** they were chosen. Read this before making structural changes.

## System overview
```
                         ┌──────────────────────────────────────────┐
   User (email/Google) ──▶  Privy: embedded wallet + SMART WALLET    │
                         └───────────────┬──────────────────────────┘
                                         │ signs
        ┌────────────────────────────────┼─────────────────────────────────┐
        │            packages/nextjs (Next.js App Router, Vercel)           │
        │   PrivyConnectButton · useSponsoredWrite · useScaffoldReadContract │
        └──────────┬───────────────────────────────────┬───────────────────┘
        sponsored UserOp                          reads / off-chain
                   │                                     │
   ┌───────────────▼───────────────┐     ┌───────────────▼──────────────┐
   │  Sepolia (Privy managed        │     │  Supabase (profiles, RLS)    │
   │  paymaster → "App pays" credits)│     │  off-chain cache/user data   │
   │  packages/foundry contracts     │     └──────────────────────────────┘
   └─────────────────────────────────┘
```

## Onchain vs off-chain — the split
- **Onchain (`packages/foundry`)**: ownership, transfers, lending positions, collateral — the *commitments* that must be trustless. Keep to **0–2 contracts** for the MVP.
- **Off-chain (Supabase)**: everything else — user profiles, cached/derived state, indexed events, UI metadata. Cheaper, faster, mutable. Never put logic onchain that doesn't need to be trustless.

## The sponsored-transaction flow (core pattern)
thelender's premise is **users pay no gas**. This is delivered by **Privy native smart wallets**, not the wagmi smart-account connector.

1. User logs in (Privy) → an **embedded wallet** (EOA signer) + a **smart wallet** (ERC-4337) are created.
2. A user action calls **`useSponsoredWrite()`** (`hooks/scaffold-eth/useSmartWallet.ts`):
   - `writeContractSponsored({ address, abi, functionName, args })` — single call, or
   - `sendCalls([...])` — atomic batch (e.g. `approve` + `deposit` in one UserOp).
3. The Privy smart-wallet client submits a **UserOperation** routed through Privy's **managed paymaster**, which draws from the dashboard **"App pays" gas credits**. The user signs; the smart wallet pays nothing.
4. **Reads** use `useScaffoldReadContract({ ..., account: useSmartWalletAddress() })` so balances/positions reflect the **smart wallet** address (where funds live), not the EOA signer.

> ⚠️ Do **not** use `useScaffoldWriteContract` for user writes — it signs from the embedded EOA and is **not** sponsored. See `docs/privy.md`.

## Data model (Supabase)
- Project: **`creditline`** (ref `rooclfwqvmwehaqmtflp`, us-east-2). One table so far: `public.profiles` (PK `wallet_address` = smart-wallet address; `ens_name`, timestamps). **RLS on, no anon policies** → server/service-role access only.
- Auth is **Privy, not Supabase Auth**, so there's no `auth.uid()`. Privileged writes happen server-side with the service-role key. A Privy→Supabase JWT bridge (per-user client access) is a planned enhancement — see `docs/infra.md`.

## Key decisions (ADR-lite)
| Decision | Why |
|----------|-----|
| **Base = Scaffold-ETH 2** | Proven contract↔frontend hot-reload, typed hooks, local chain/faucet — fastest path to a working dApp. Our value (AI lab) layers on top, base-agnostic. |
| **Wallet = Privy, native smart wallets** | Gasless onboarding (embedded + social login) is core to a lending UX. We chose **native** smart wallets (`useSmartWallets().client`) over the `@privy-io/wagmi` connector because native uses Privy's **managed paymaster / dashboard credits** — the connector path needs a separate external ZeroDev/Pimlico paymaster. (A code review caught an early bug where the connector returned the bare EOA → un-sponsored; that's why this is documented loudly.) |
| **Chain = Ethereum Sepolia** | Privy's bundler + managed paymaster run on real networks, not local anvil. Sepolia is the free testnet where sponsorship works; everything (RPC, Foundry deploy/verify) is aligned to it. Mainnet is used only for ENS resolution. |
| **Off-chain = Supabase** | RLS-by-default Postgres + Auth + Realtime + Edge Functions; pairs with the `supabase` skill+MCP. Reused the existing empty `creditline` project (free-tier 2-project limit blocked a new one). |
| **RainbowKit removed** | Privy is the sole wallet/auth; RainbowKit + burner-connector were fully removed to avoid two competing wallet stacks. |

## Where to go next
- Privy specifics & dashboard sponsorship setup → `docs/privy.md`
- RPC / chains → `docs/rpc.md` · Supabase/Railway → `docs/infra.md` · indexing/explorers → `docs/indexing-explorers.md`
- Full tooling (MCPs, agents, commands, skills) → `docs/tooling-lab.md`
- Rules & conventions → `CLAUDE.md` · contribution flow → `CONTRIBUTING.md`
