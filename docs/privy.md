# Privy Integration Notes

Skill: `.claude/skills/privy/SKILL.md` · Live docs: **`privy-docs` MCP** (`https://docs.privy.io/mcp`).

Privy is the **default wallet/auth** for this app (RainbowKit removed). It provides
login (email / wallet / Google), **embedded wallets** auto-created on login, and
**smart wallets** (ERC-4337) with **gas sponsorship** ("sponsored wallets") that is
configured in the Privy Dashboard, not in code.

> Always confirm current API shapes via the skill / `privy-docs` MCP — props change.

---

## What was implemented (packages/nextjs)

### Packages
- `@privy-io/react-auth` (^3.29) — `PrivyProvider`, `usePrivy`, and `@privy-io/react-auth/smart-wallets` (`SmartWalletsProvider`, `useSmartWallets`).
- `@privy-io/wagmi` (^4.0) — drop-in `createConfig` + `WagmiProvider`, and `useEmbeddedSmartAccountConnector`.
- `permissionless` (0.2.57) — peer dependency of Privy's native smart wallets.
- `viem` pinned to `2.52.0` (required exactly by `@privy-io/wagmi@4`).

### Provider nesting (`components/ScaffoldEthAppWithProviders.tsx`)
Client-side, with a real `NEXT_PUBLIC_PRIVY_APP_ID`:

```
PrivyProvider (config = privyConfig + runtime theme)
  └─ SmartWalletsProvider              // native ERC-4337 smart wallets
       └─ QueryClientProvider
            └─ WagmiProvider           // from @privy-io/wagmi (drop-in)
                 ├─ PrivySmartAccountConnector   // registers smart account w/ wagmi
                 ├─ ProgressBar
                 └─ ScaffoldEthApp
```

Confirmed against:
- `wallets/connectors/ethereum/integrations/wagmi` — `createConfig`/`WagmiProvider` from `@privy-io/wagmi`, provider order.
- `wallets/using-wallets/evm-smart-wallets/overview` and `.../setup/configuring-sdk` — `SmartWalletsProvider` nested inside `PrivyProvider`; peer deps `permissionless`, `viem`.
- `recipes/account-abstraction/wagmi` — `useEmbeddedSmartAccountConnector({ getSmartAccountFromSigner })` so wagmi reflects the smart account → SE-2 write hooks send sponsored UserOps.
- `basics/react/advanced/configuring-evm-networks` — `defaultChain` / `supportedChains`.

### Privy config (`services/web3/privyConfig.ts`)
```ts
embeddedWallets: { ethereum: { createOnLogin: 'all-users' }, showWalletUIs: true }
loginMethods: ['email', 'wallet', 'google']
defaultChain:   targetNetworks[0]               // from scaffold.config
supportedChains: targetNetworks (+ mainnet for ENS)
appearance:     { theme, accentColor: '#2299dd' } // theme overridden at runtime
```
> In `@privy-io/react-auth` v3, `createOnLogin` lives under `embeddedWallets.ethereum`, not at the top level.

### wagmi config (`services/web3/wagmiConfig.tsx`)
- `createConfig` now imported from `@privy-io/wagmi` (drop-in).
- `connectors: wagmiConnectors()` **removed** — Privy injects connectors.
- `enabledChains` and the `client`/transport/fallback logic are unchanged.

### Connect button (`components/scaffold-eth/PrivyConnectButton.tsx`)
- `usePrivy()` → `{ ready, authenticated, login, logout }`; wagmi `useAccount` / `useSwitchChain` (via `NetworkOptions`).
- Shows ENS name + avatar (resolved on **Mainnet**, chainId 1) with truncated-address fallback, a Blockie, balance, network name, wrong-network switch, copy, explorer link, and Privy `logout`.
- Swapped into `components/Header.tsx`. The old RainbowKit button files are left in place but unused.

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
- The smart wallet address is in `user.linkedAccounts` as `type === 'smart_wallet'`;
  the native client (`useSmartWallets().client`) also supports batched + sponsored
  `sendTransaction` directly.
- For server auth, verify the Privy access token (JWT) in API routes / middleware.
