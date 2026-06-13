# Privy Integration Notes

Skill: `.claude/skills/privy/SKILL.md` · Live docs: **`privy-docs` MCP** (`https://docs.privy.io/mcp`).

Privy = login (email/social/wallet) + **embedded wallets** for users who don't have one. Always confirm current API shapes via the skill/MCP — props change.

## Setup shape (Next.js App Router)
1. `npm i @privy-io/react-auth`
2. Client `PrivyProvider` wrapper configured with `NEXT_PUBLIC_PRIVY_APP_ID`, default chain, and embedded-wallet config (`createOnLogin: 'users-without-wallets'`).
3. Mount it in the root `layout.tsx`, wrapping the wagmi provider.
4. `usePrivy()` for `{ ready, authenticated, login, logout, user }`; `useWallets()` for wallet access.
5. Bridge to wagmi so `useReadContract`/`useWriteContract` use the Privy wallet.

## Env
- `NEXT_PUBLIC_PRIVY_APP_ID` — public, client.
- `PRIVY_APP_SECRET` — **server only**, for verifying tokens / server-side wallet ops. Never to the client.

## Notes
- Embedded wallets are non-custodial; keys are split/secured by Privy, surfaced to your app via the SDK.
- For server auth, verify the Privy access token (JWT) in API routes / middleware.
