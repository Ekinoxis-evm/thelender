# Privy Integration Notes

Skill: `.claude/skills/privy/SKILL.md` · Live docs: **`privy-docs` MCP** (`https://docs.privy.io/mcp`).

Privy is the **default wallet/auth** for Kredito (RainbowKit + burner-connector removed). It provides
login via **email + Google only** (no external wallet connectors), an **embedded wallet**
auto-created on login, and an **ERC-4337 smart wallet** with **gas sponsorship** ("sponsored
wallets") configured in the Privy Dashboard, not in code. Email/Google-only login plus the embedded
→ smart-wallet path gives every Kredito user one consistent gasless UX with no wallet setup.

> Always confirm current API shapes via the skill / `privy-docs` MCP — props change.

---

## What was implemented (packages/nextjs)

### Packages
- `@privy-io/react-auth` (^3.29) — `PrivyProvider`, `usePrivy`, and `@privy-io/react-auth/smart-wallets` (`SmartWalletsProvider`, `useSmartWallets`).
- `@privy-io/wagmi` (^4.0) — drop-in `createConfig` + `WagmiProvider` (used for reads / chain state only).
- `permissionless` (0.2.57) — peer dependency of Privy's native smart wallets.
- `viem` pinned to `2.52.0` (required exactly by `@privy-io/wagmi@4`).

### Provider nesting (`components/ScaffoldEthAppWithProviders.tsx`)
Client-side, with a real `NEXT_PUBLIC_PRIVY_APP_ID`:

```
PrivyProvider (config = privyConfig + runtime theme)
  └─ SmartWalletsProvider              // native ERC-4337 smart wallets
       └─ QueryClientProvider
            └─ WagmiProvider           // from @privy-io/wagmi (reads / chain state only)
                 ├─ ProgressBar
                 └─ ScaffoldEthApp
```

We do **not** bridge the smart account through wagmi (`useEmbeddedSmartAccountConnector`
was removed). That wagmi bridge needs an *external* ZeroDev/Pimlico paymaster and does
not use the dashboard's managed gas credits. Instead, writes are sent directly through
the native smart-wallet client (`useSmartWallets().client`), whose UserOps route through
Privy's **managed paymaster = your dashboard "App pays" gas credits**.

Confirmed against:
- `wallets/connectors/ethereum/integrations/wagmi` — `createConfig`/`WagmiProvider` from `@privy-io/wagmi`, provider order.
- `wallets/using-wallets/evm-smart-wallets/overview` and `.../setup/configuring-sdk` — `SmartWalletsProvider` nested inside `PrivyProvider`; peer deps `permissionless`, `viem`.
- `wallets/using-wallets/evm-smart-wallets/usage` — `useSmartWallets().client.sendTransaction(...)` (single + batched, sponsored).
- `basics/react/advanced/configuring-evm-networks` — `defaultChain` / `supportedChains`.

### Privy config (`services/web3/privyConfig.ts`)
```ts
embeddedWallets: { ethereum: { createOnLogin: 'all-users' }, showWalletUIs: true }
loginMethods: ['email', 'google']               // email + Google ONLY — no external wallet connectors
defaultChain:   targetNetworks[0]               // from scaffold.config (Sepolia)
supportedChains: targetNetworks (+ mainnet for ENS)
appearance:     { theme, accentColor: '#2299dd', showWalletLoginFirst: false } // theme overridden at runtime
```
> In `@privy-io/react-auth` v3, `createOnLogin` lives under `embeddedWallets.ethereum`, not at the top level.

### wagmi config (`services/web3/wagmiConfig.tsx`)
- `createConfig` imported from `@privy-io/wagmi` (drop-in), **no connectors** — Privy injects them.
- wagmi still tracks the embedded wallet (used for READS / chain state); the smart
  account is **not** bridged through wagmi.
- `enabledChains` and `privyConfig.supportedChains` share one helper,
  `withMainnet()` (`services/web3/enabledChains.ts`), so mainnet (for ENS) is always
  present exactly once and the two configs never drift.

### Native smart-wallet write path (`hooks/scaffold-eth/useSmartWallet.ts`)
Sponsored writes go through the native smart-wallet client, **not** SE-2's
`useScaffoldWriteContract`:

```ts
const { client } = useSmartWallets();                  // @privy-io/react-auth/smart-wallets

// single sponsored tx (encode the call with viem's encodeFunctionData):
await client.sendTransaction({ chain, to, data, value? });   // → tx hash (Hex)

// atomic batch (e.g. approve + deposit in one UserOp):
await client.sendTransaction({ calls: [{ to, data, value? }, ...] });
```

This repo wraps that in `useSponsoredWrite()`:
- `writeContractSponsored({ address, abi, functionName, args, value? })` — encodes via
  `encodeFunctionData` and sends one sponsored tx on the SE-2 `useTargetNetwork()` chain.
- `sendCalls(calls)` — atomic sponsored batch.
- `{ isPending, error, lastTxHash }` for UI state; throws a clear error if `client` isn't
  ready (not logged in / smart wallets not enabled in the dashboard).

The same file also exports **`useSmartWalletSign()`** — `client.signMessage({ message })` on the
smart wallet (ERC-191 → ERC-1271/6492 signature that `viem.verifyMessage` validates server-side, even
before the account is deployed). It is **off-chain and free** (not a sponsored tx), and is how Kredito
proves wallet control to backend routes — e.g. signing the `mintMessage` for the
`<label>.kredito.eth` identity mint.

**Reads** keep using SE-2's `useScaffoldReadContract`, but pass
`{ account: useSmartWalletAddress() }` so balances/allowances reflect the **smart
wallet**, not the embedded EOA signer. The smart wallet address comes from
`usePrivy().user.linkedAccounts` where `type === 'smart_wallet'`
(`useSmartWalletAddress()`), `undefined` until it is created.

### Connect button (`components/scaffold-eth/PrivyConnectButton.tsx`)
- `usePrivy()` → `{ ready, authenticated, login, logout }`; wagmi `useAccount` (chain) / `useSwitchChain` (via `NetworkOptions`).
- Primary identity is the **smart wallet** address (`useSmartWalletAddress()`), falling
  back to the embedded EOA only while the smart wallet is still being created. Blockie /
  ENS / Balance / explorer link are all keyed to that address.
- Shows ENS name + avatar (resolved on **Mainnet**, chainId 1) with truncated-address fallback, a Blockie, balance, network name, wrong-network switch, copy, explorer link, and Privy `logout`.
- When wagmi hasn't reported the active `chain` yet, it shows the pulsing placeholder
  instead of skipping the wrong-network guard.
- Swapped into `components/Header.tsx`. RainbowKit and burner-connector were **fully removed** (deps + files); `NetworkOptions` was salvaged to `components/scaffold-eth/`.

### Build-safety with an empty App ID
CI / prerender has no key. `ScaffoldEthAppWithProviders` renders a **plain wagmi**
`WagmiProvider` (not `@privy-io/wagmi`'s) during SSR and whenever the App ID is
missing — because Privy's wagmi connector calls `useWallets`, which requires
`PrivyProvider` context and would otherwise throw during prerender. The full Privy
stack only mounts client-side once an App ID is present. **A real
`NEXT_PUBLIC_PRIVY_APP_ID` is required at runtime** for login to work.

---

## Env
- `NEXT_PUBLIC_PRIVY_APP_ID` — public, client. **Required at runtime.** Already listed in `packages/nextjs/.env.example`.
- `PRIVY_APP_SECRET` — **server only**, for verifying tokens / server-side wallet ops. Never expose to the client.

---

## Enable sponsored wallets — Dashboard checklist

Gas sponsorship is **configured in the Privy Dashboard, not in code.** The SDK code
above only mounts `SmartWalletsProvider`; the paymaster that actually pays gas is
registered in the dashboard. Steps (https://dashboard.privy.io):

1. **Create the app & copy the App ID** → App settings → Basics. Put it in
   `NEXT_PUBLIC_PRIVY_APP_ID`.
2. **Enable embedded wallets** → Wallets → Embedded wallets. Match the code:
   create on login for all users. (We use `createOnLogin: 'all-users'`.)
3. **Enable smart wallets** → Wallets → Smart wallets (or
   `dashboard.privy.io/apps?page=smart-wallets`). Toggle on and **pick a smart-wallet
   type** (Alchemy / Kernel (ZeroDev) / Safe / Biconomy / Thirdweb / Coinbase Smart
   Wallet). Existing users keep their original type if you change it later.
4. **Configure supported networks** for smart wallets — add **every** chain your app
   uses (must match the app's `defaultChain` / `supportedChains`, i.e. your
   `scaffold.config.targetNetworks`). For each network you may set a bundler URL and a
   paymaster URL.
5. **Register a paymaster URL** for each network (this is what turns on sponsorship).
   If no paymaster URL is set, users must hold native gas themselves. Get one from
   Pimlico / ZeroDev / Alchemy / Biconomy / Thirdweb / Coinbase. For **Alchemy**,
   provide the gas policy ID (chain- and project-specific).
   - Optionally set a **bundler URL** too. Privy defaults to Pimlico's public bundler
     (`https://public.pimlico.io/v2/{chainId}/rpc`), which is rate-limited and **not**
     production-grade — set your own for production.
6. **Add gas credits / fund the paymaster** in your paymaster provider's dashboard so
   sponsored transactions don't fail with `insufficient_funds`.
7. **Set allowed domains** — in the Privy Dashboard (allowed origins for the App ID)
   **and** in your paymaster/bundler provider's dashboard (restrict the paymaster/
   bundler URLs to your site only), so your sponsorship credits can't be drained from
   other origins.
8. (Optional) For **Biconomy/Alchemy** paymaster context overrides, pass
   `config={{ paymasterContext: {...} }}` to `SmartWalletsProvider`
   (`wallets/using-wallets/evm-smart-wallets/usage`).

Once 1–7 are done, the embedded wallet signs and the **smart wallet** sends
transactions; Privy routes the UserOp through the registered paymaster, so the user
pays no gas. No code change is needed to toggle sponsorship on/off — it follows the
dashboard paymaster configuration.

---

## Runtime notes
- Always gate on `usePrivy().ready` before reading auth state (Privy inits async).
- Embedded wallets are non-custodial; keys are split/secured by Privy.
- The smart wallet address is in `user.linkedAccounts` as `type === 'smart_wallet'`
  (`useSmartWalletAddress()`); the native client (`useSmartWallets().client`) supports
  batched + sponsored `sendTransaction` directly (`useSponsoredWrite()`).
- For server auth, verify the Privy access token (JWT) in API routes / middleware.
