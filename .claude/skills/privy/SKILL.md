---
name: Privy
description: Use when building wallet infrastructure, authenticating users, managing embedded wallets, signing transactions, configuring access controls and policies, or integrating wallet functionality into web, mobile, or backend applications across Ethereum, Solana, and 50+ blockchains.
metadata:
    mintlify-proj: privy
    version: "1.0"
---

# Privy Skill

## Product summary

Privy is a wallet infrastructure and authentication platform that enables developers to embed wallets and user authentication into applications. It provides SDKs for React, React Native, Swift, Android, Flutter, Unity, and backend languages (Node.js, Go, Java, Rust, Ruby), plus a REST API for server-side wallet management.

**Key files and commands:**
- **App ID and App Secret**: Found in Privy Dashboard > App Settings > Basics. Required for all API calls.
- **PrivyProvider** (React): Wraps your app to enable Privy functionality. Requires `appId` and `clientId`.
- **PrivyClient** (Node.js/Go/Java/Rust/Ruby): Server-side client initialized with `appId` and `appSecret`.
- **REST API base**: `https://api.privy.io/v1/`
- **Authentication**: Basic Auth header with `appId:appSecret` + `privy-app-id` header.
- **Webhooks**: Configure at Dashboard > Configuration > Webhooks. Verify payloads using SDK or Svix.

**Primary docs**: https://docs.privy.io

## When to use

Reach for this skill when:
- Building user authentication flows (email, SMS, social, wallet, passkey, OAuth)
- Creating or managing embedded wallets for users or servers
- Signing and broadcasting transactions on EVM, Solana, or other chains
- Setting up wallet access controls, ownership models, and policies
- Implementing multi-factor authentication or security features
- Handling wallet funding (fiat onramps, deposits, withdrawals)
- Tracking transactions, balances, and wallet events via webhooks
- Migrating users or wallets from other systems
- Building trading apps, treasury wallets, or agent wallets with strict controls
- Integrating external wallets (MetaMask, Phantom, etc.) alongside embedded wallets

## Quick reference

### SDK initialization

| Platform | Code |
|----------|------|
| **React** | `<PrivyProvider appId="..." clientId="..." config={{...}}>` |
| **React Native** | `<PrivyProvider appId="..." clientId="..." config={{...}}>` |
| **Node.js** | `new PrivyClient({appId, appSecret})` |
| **Go** | `privy.NewPrivyClient(privy.PrivyClientOptions{AppID, AppSecret})` |
| **Java** | `PrivyClient client = new PrivyClient(appId, appSecret)` |
| **REST API** | `curl -u "appId:appSecret" -H "privy-app-id: appId"` |

### Common wallet operations

| Task | Method/Endpoint |
|------|-----------------|
| Create wallet | `privy.wallets().create({chain_type, owner})` or `POST /v1/wallets` |
| Get wallet | `privy.wallets().get(walletId)` or `GET /v1/wallets/{id}` |
| Send transaction | `privy.wallets().ethereum().sendTransaction(walletId, {...})` or `POST /v1/wallets/{id}/rpc` |
| Get balance | `privy.wallets().getBalance(walletId)` or `GET /v1/wallets/{id}/balance` |
| Get transactions | `privy.wallets().getTransactions(walletId)` or `GET /v1/wallets/{id}/transactions` |
| Sign message | `privy.wallets().ethereum().personalSign(walletId, message)` |

### Authentication methods

| Method | Use case |
|--------|----------|
| Email/SMS | Passwordless, broad audience |
| Social (Google, Discord, Twitter, etc.) | Familiar login, social graph |
| Wallet (MetaMask, Phantom) | Crypto-native users, existing wallets |
| Passkey | Biometric, hardware key support |
| OAuth/Custom | Integrate with existing auth system |
| JWT-based | Use your own authentication provider |

### Wallet ownership models

| Model | Owner | Use case |
|-------|-------|----------|
| User-owned | User ID | Self-custodial consumer wallets |
| User + server | User ID + authorization key | Automated trading, limit orders |
| Application-owned | Authorization key | Treasury, trading bots, agents |
| Custodial | Licensed custodian | FBO banking model, regulated custody |

### Policy configuration

Policies enforce rules on wallet actions. Common constraints:
- **Spending limits**: Max transaction amount
- **Allowlisted addresses**: Approved recipients
- **Contract interactions**: Allowed smart contracts
- **Time windows**: When actions are permitted
- **Asset types**: Which tokens can be transferred

## Decision guidance

### When to use embedded vs. external wallets

| Aspect | Embedded | External |
|--------|----------|----------|
| **User experience** | Seamless, no setup | Familiar to power users |
| **Key control** | Privy infrastructure (user can export) | User controls keys directly |
| **Onboarding friction** | Low (auto-create on login) | High (requires existing wallet) |
| **Best for** | Consumer apps, new users | Leveraging existing balances, crypto natives |
| **Setup** | `createOnLogin: 'users-without-wallets'` | Configure external connectors |

### When to use client-side vs. server-side SDKs

| Aspect | Client-side (React, React Native, etc.) | Server-side (Node.js, Go, etc.) |
|--------|----------------------------------------|--------------------------------|
| **User wallets** | Create, sign, manage user-owned wallets | Create user wallets, manage via API |
| **Server wallets** | Not supported | Create, manage, automate transactions |
| **Authentication** | Use Privy auth or JWT-based | Verify tokens, manage users |
| **Transactions** | User signs via UI | Server signs with authorization keys |
| **Best for** | Interactive UX, user control | Backend automation, treasury, agents |

### When to use Privy auth vs. JWT-based auth

| Aspect | Privy Auth | JWT-based |
|--------|-----------|-----------|
| **Setup** | Built-in, multi-method support | Integrate with existing provider |
| **Methods** | Email, SMS, social, wallet, passkey, OAuth | Your system's methods |
| **Maintenance** | Privy maintains | You maintain |
| **Best for** | New apps, multi-method auth | Existing auth system, custom flows |

## Workflow

### 1. Set up your Privy app
1. Go to https://dashboard.privy.io
2. Create a new app
3. Copy your **App ID** and **App Secret** from App Settings > Basics
4. Store secrets in environment variables (never commit to code)

### 2. Initialize Privy in your app
**For React:**
```tsx
<PrivyProvider appId="..." clientId="..." config={{embeddedWallets: {ethereum: {createOnLogin: 'users-without-wallets'}}}}>
  <App />
</PrivyProvider>
```

**For Node.js:**
```ts
const privy = new PrivyClient({appId: process.env.PRIVY_APP_ID, appSecret: process.env.PRIVY_APP_SECRET});
```

### 3. Authenticate users
- Use `usePrivy()` hook (React) or `privy.users()` (server) to manage authentication
- Configure login methods in Dashboard > Configuration > Login Methods
- For custom auth, set up JWT-based authentication

### 4. Create wallets
- **Client-side**: Call `useCreateWallet()` hook after user logs in
- **Server-side**: Call `privy.wallets().create({chain_type: 'ethereum', owner: {user_id}})` with user ID
- Specify owner (user ID or authorization key) and optional policies

### 5. Send transactions
- **Client-side**: Use `useSendTransaction()` hook or wallet provider's RPC methods
- **Server-side**: Call `privy.wallets().ethereum().sendTransaction(walletId, {...})` with authorization signature
- Include transaction details (to, value, data, chain ID)
- Optionally enable gas sponsorship with `sponsor: true`

### 6. Set up controls and policies
1. Define policies in Dashboard > Wallets > Policies or via API
2. Attach policies to wallets at creation or update
3. Test policy enforcement by attempting transactions that violate rules

### 7. Configure webhooks
1. Create a POST endpoint on your backend to receive events
2. Go to Dashboard > Configuration > Webhooks
3. Add endpoint URL (must be HTTPS)
4. Select event types (user, wallet, transaction, intent, etc.)
5. Verify webhook signatures using SDK or Svix

### 8. Monitor and debug
- Check Dashboard > Wallets for wallet status and transaction history
- Use webhooks to track real-time events
- Review API error codes and logs for troubleshooting
- Test locally with ngrok or Cloudflare Tunnel

## Common gotchas

- **Missing `ready` check**: Always check `usePrivy().ready` before consuming Privy state in React. Privy initializes asynchronously.
- **Authorization signatures required**: Wallets with `owner_id` require authorization signatures for API calls. Use `AuthorizationContext` in server SDKs to automate this.
- **Policy violations silently block**: Transactions blocked by policies return `policy_violation` error. Review policy rules if transactions fail unexpectedly.
- **Gas sponsorship credits depleted**: If gas sponsorship fails with `insufficient_funds`, check your gas credits balance in Dashboard > Billing > Gas Sponsorship.
- **Webhook delivery is "at least once"**: Webhooks may be delivered multiple times. Use `idempotency_key` to deduplicate.
- **User session keys expire**: User signing keys are time-bound. Server SDKs with `AuthorizationContext` refresh automatically; manual implementations must request fresh keys.
- **Incorrect CAIP2 format**: Chain IDs must be in CAIP2 format (e.g., `eip155:1` for Ethereum mainnet, `solana:mainnet` for Solana). Mismatched formats cause transaction failures.
- **Nonce conflicts on retries**: If a transaction broadcast fails, it's safe to retry. If it succeeds but you don't see confirmation, check the hash on a block explorer before retrying.
- **External wallets require explicit setup**: External wallet connectors must be configured in Dashboard > Configuration > External Wallets before they appear in your app.
- **Policies evaluated at request time**: Policies are checked when the transaction is submitted, not when the user initiates it. Ensure UI reflects current policy state.

## Verification checklist

Before submitting work with Privy:

- [ ] App ID and App Secret are stored in environment variables, not hardcoded
- [ ] `PrivyProvider` wraps the entire app (React) or `PrivyClient` is initialized (server)
- [ ] `ready` state is checked before consuming Privy hooks (React)
- [ ] Wallet owner is correctly specified (user ID for user wallets, authorization key for server wallets)
- [ ] Policies are attached to wallets if access control is required
- [ ] Authorization signatures are included for wallets with `owner_id` (server-side)
- [ ] Transaction parameters are valid (correct chain ID in CAIP2 format, valid recipient address)
- [ ] Gas sponsorship is enabled if users shouldn't pay gas fees
- [ ] Webhook endpoint is HTTPS and returns 2xx status
- [ ] Webhook signatures are verified before processing
- [ ] Error handling covers `policy_violation`, `insufficient_funds`, and authorization errors
- [ ] Rate limits are handled with exponential backoff (especially for wallet creation)
- [ ] Idempotency keys are used for critical operations (wallet creation, transactions)

## Resources

**Comprehensive navigation**: https://docs.privy.io/llms.txt

**Critical documentation pages**:
1. [Key Concepts](https://docs.privy.io/basics/key-concepts) — Understand authentication, wallets, and controls
2. [Create a Wallet](https://docs.privy.io/wallets/wallets/create/create-a-wallet) — Wallet creation across all SDKs
3. [API Reference](https://docs.privy.io/api-reference/introduction) — Complete REST API documentation with examples

---

> For additional documentation and navigation, see: https://docs.privy.io/llms.txt