---
description: Scaffold Privy auth + embedded wallets into the Next.js app, grounded in live Privy docs.
---

Set up Privy authentication and embedded wallets. Consult the **`privy` skill** (`.claude/skills/privy`) and the **`privy-docs` MCP** for current API shapes — do not guess prop or hook names.

Steps:
1. Install `@privy-io/react-auth` (+ `wagmi`/`viem` connector if not present).
2. Create a `PrivyProvider` wrapper (client component) configured with `NEXT_PUBLIC_PRIVY_APP_ID`, the app's default chain, and embedded-wallet creation for users without a wallet.
3. Wire the provider into the App Router root layout (above wagmi config).
4. Add a login/logout button + a hook exposing the authenticated user and their wallet address.
5. Bridge Privy → wagmi so contract hooks use the Privy wallet.
6. Confirm `NEXT_PUBLIC_PRIVY_APP_ID` / `PRIVY_APP_SECRET` are in `.env.example` (already are) and remind the user to fill `.env.local` from the Privy dashboard.

Hand off to the `web3-frontend` agent. $ARGUMENTS
