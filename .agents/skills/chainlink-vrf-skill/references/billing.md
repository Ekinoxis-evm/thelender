# VRF v2.5 Billing

## Premium Percentages

VRF v2.5 charges a premium on top of the base gas cost:

| Payment Token | Premium (Ethereum Mainnet) |
|---|---|
| LINK | 20% |
| Native coin (ETH, MATIC, etc.) | 24% |

Native coin payment carries a slightly higher premium than LINK. If cost efficiency matters, pay in LINK.

Note: Premium percentages may differ on other networks. Check https://docs.chain.link/vrf/v2-5/billing.md for network-specific values.

## Billing Timing

### Subscription Method
Billing is **post-fulfillment**. The actual gas consumed during the callback is measured and deducted from the subscription balance after `fulfillRandomWords` completes. You are charged for gas actually used, not an estimate.

### Direct Funding Method
Billing is **upfront**. The cost is estimated at request time and charged when `requestRandomWords` is called. The contract must hold sufficient balance before the call, or it will revert.

## Cost Formula

### Subscription
```
total gas cost = gas_price × (verification_gas + callback_gas_used)
total request cost = total gas cost × ((100 + premium%) / 100)
```

`callback_gas_used` is the actual gas consumed — you are charged for what was used, not the full limit.

### Direct Funding
```
total gas cost = gas_price × (coordinator_overhead + callback_gas_limit + wrapper_overhead + (per_word_overhead × num_words))
total request cost = (coordinator_flat_fee + total gas cost) × ((100 + wrapper_premium%) / 100)
```

`callback_gas_limit` is the value you set — you pay for the full limit even if your callback uses less.

`coordinator_flat_fee` is denominated in millionths of LINK (see supported networks page for per-chain values).

### Gas Overhead Values (Ethereum Mainnet)

| Component | LINK Payment | Native (ETH) Payment |
|---|---|---|
| Coordinator overhead | 112,000 gas | 90,000 gas |
| Wrapper overhead | 13,400 gas | 13,400 gas |
| Per-word overhead | 435 gas/word | 435 gas/word |
| Premium | 20% | 24% |

These values differ per network. Check the supported networks page for the canonical values.

> **Note:** These examples use Ethereum Mainnet values from the official docs. Testnet overhead values (e.g. Sepolia) differ — check the [Supported Networks](https://docs.chain.link/vrf/v2-5/supported-networks.md) page for the network you are targeting before estimating costs.

### Worked Example: Subscription (LINK Payment, Ethereum Mainnet)

Inputs: gas lane 500 gwei, callback gas limit 100,000, max verification gas 200,000, premium 20%, ETH/LINK = 0.005 ETH/LINK

**Minimum subscription balance** (worst-case, at gas lane ceiling):
```
500 gwei × (200,000 + 100,000) = 150,000,000 gwei = 0.15 ETH
0.15 ETH × (100 + 20) / 100   = 0.18 ETH
0.18 ETH / 0.005 ETH/LINK      = 36 LINK
```

For this example request to go through, you need to reserve a minimum subscription balance of 36 LINK, but that does not mean the actual request will cost 36 LINK.

You need to pre-fund your subscription enough to meet the minimum subscription balance in order to have a buffer against gas volatility.

**Actual request cost** (at real gas price, e.g. 50 gwei):
```
50 gwei × (115,000 + 95,000)  = 10,500,000 gwei = 0.0105 ETH
0.0105 ETH × (100 + 20) / 100 = 0.0126 ETH
0.0126 ETH / 0.005 ETH/LINK   = 2.52 LINK
```

The subscription holds 36 LINK as a reserve but only deducts 2.52 LINK at fulfillment.

### Worked Example: Direct Funding (LINK Payment, Ethereum Mainnet)

Inputs: 50 gwei gas price, 100,000 callback gas limit, 2 random words, ETH/LINK = 0.004 ETH/LINK

```
50 gwei × (112,000 + 100,000 + 13,400 + (435 × 2)) = 11,313,500 gwei = 0.0113135 ETH
0.0113135 ETH / 0.004 ETH/LINK                      = 2.828375 LINK
2.828375 LINK × (100 + 20) / 100                    = 3.39405 LINK
```

## Choosing LINK vs Native Coin

Ask the user which option they prefer (LINK or native coin), default to LINK.

Per-request payment method is controlled by the `nativePayment` flag in `extraArgs` (subscription) or the `requestRandomnessPayInNative` function (direct funding). Subscriptions must be funded with the corresponding token.

## Funding a Subscription

**With LINK (ERC-677 transferAndCall):**
```solidity
// Programmatic funding
LINK.transferAndCall(
    coordinatorAddress,
    linkAmount,
    abi.encode(subscriptionId)
);
```

Or instruct the user to fund via the UI at https://vrf.chain.link.

**With native coin:**
```solidity
coordinator.fundSubscriptionWithNative{value: amount}(subscriptionId);
```

## Withdrawal from Subscription

```solidity
// Withdraw LINK
coordinator.cancelSubscription(subscriptionId, receivingAddress);

// Or just withdraw excess without cancelling — use the VRF UI
```

## PegSwap: Polygon and BNB Chain

On **Polygon** and **BNB Chain**, the LINK token from the canonical bridge is **not ERC-677 compatible**. You must convert it to ERC-677 LINK using PegSwap before it can be used to fund a VRF subscription or direct-funding contract.

- PegSwap: https://pegswap.chain.link
- Convert bridged LINK (ERC-20) → native LINK (ERC-677) before funding.

This only applies to bridge-sourced LINK. LINK purchased directly on these chains is already ERC-677.
