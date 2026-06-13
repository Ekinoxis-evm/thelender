# Migrating from VRF V2 to v2.5

## Why Migrate

VRF V2 coordinators are being deprecated. V2 contracts will not work with v2.5 coordinator addresses. The changes are all breaking — V2 code requires modification before it will compile against v2.5 contracts.

**Official migration guide:** https://docs.chain.link/vrf/v2-5/migration-from-v2.md

## Detection Cues (V2 / V1 Patterns to Spot)

Any of these in user-supplied code signals a legacy contract:

```solidity
// V2 import paths
import {VRFConsumerBaseV2} from "@chainlink/contracts/src/v0.8/vrf/VRFConsumerBaseV2.sol";
import {VRFCoordinatorV2Interface} from "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";

// V1 import path
import {VRFConsumerBase} from "@chainlink/contracts/src/v0.8/VRFConsumerBase.sol";

// V2 direct funding
import {VRFV2WrapperConsumerBase} from "@chainlink/contracts/src/v0.8/vrf/VRFV2WrapperConsumerBase.sol";

// V2 sub ID type
uint64 s_subscriptionId;

// V2 positional requestRandomWords
COORDINATOR.requestRandomWords(keyHash, s_subscriptionId, requestConfirmations, callbackGasLimit, numWords);

// V2 wrapper constructor with two args
VRFV2WrapperConsumerBase(linkAddress, wrapperAddress)

// V2 fulfill signature
function fulfillRandomWords(uint256 requestId, uint256[] memory randomWords) internal override {}
```

If any of these appear: **do not generate V2 code**. Apply the full migration below.

## Complete Migration Checklist

### 1. Base Contract (Subscription)

```solidity
// BEFORE (V2)
import {VRFConsumerBaseV2} from "@chainlink/contracts/src/v0.8/vrf/VRFConsumerBaseV2.sol";
import {VRFCoordinatorV2Interface} from "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";

contract MyConsumer is VRFConsumerBaseV2 {
    VRFCoordinatorV2Interface COORDINATOR;
    constructor(address coordinatorAddress, uint64 subscriptionId)
        VRFConsumerBaseV2(coordinatorAddress) {
        COORDINATOR = VRFCoordinatorV2Interface(coordinatorAddress);
        s_subscriptionId = subscriptionId;
    }
}

// AFTER (v2.5)
import {VRFConsumerBaseV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

contract MyConsumer is VRFConsumerBaseV2Plus {
    // s_vrfCoordinator is inherited — do not redeclare COORDINATOR
    constructor(address coordinatorAddress, uint256 subscriptionId)
        VRFConsumerBaseV2Plus(coordinatorAddress) {
        s_subscriptionId = subscriptionId;
    }
}
```

### 2. Subscription ID Type

```solidity
// BEFORE
uint64 public s_subscriptionId;

// AFTER
uint256 public s_subscriptionId;
```

### 3. requestRandomWords Call (Subscription)

```solidity
// BEFORE (V2 positional args)
COORDINATOR.requestRandomWords(
    keyHash,
    s_subscriptionId,
    requestConfirmations,
    callbackGasLimit,
    numWords
);

// AFTER (v2.5 struct + extraArgs)
s_vrfCoordinator.requestRandomWords(
    VRFV2PlusClient.RandomWordsRequest({
        keyHash: keyHash,
        subId: s_subscriptionId,
        requestConfirmations: requestConfirmations,
        callbackGasLimit: callbackGasLimit,
        numWords: numWords,
        extraArgs: VRFV2PlusClient._argsToBytes(
            VRFV2PlusClient.ExtraArgsV1({nativePayment: false}) // or true for native
        )
    })
);
```

Note: use `s_vrfCoordinator` (inherited), not a separate `COORDINATOR` variable.

### 4. fulfillRandomWords Signature

```solidity
// BEFORE (V2)
function fulfillRandomWords(
    uint256 requestId,
    uint256[] memory randomWords  // 'memory'
) internal override {}

// AFTER (v2.5 with @chainlink/contracts v1.1.1+)
function fulfillRandomWords(
    uint256 requestId,
    uint256[] calldata randomWords  // 'calldata'
) internal override {}
```

### 5. Direct Funding Base Contract

```solidity
// BEFORE (V2)
import {VRFV2WrapperConsumerBase} from "@chainlink/contracts/src/v0.8/vrf/VRFV2WrapperConsumerBase.sol";

contract MyConsumer is VRFV2WrapperConsumerBase {
    // V2 constructor requires LINK token address + wrapper address
    constructor(address linkAddress, address wrapperAddress)
        VRFV2WrapperConsumerBase(linkAddress, wrapperAddress) {}
}

// AFTER (v2.5)
import {VRFV2PlusWrapperConsumerBase} from "@chainlink/contracts/src/v0.8/vrf/dev/VRFV2PlusWrapperConsumerBase.sol";

contract MyConsumer is VRFV2PlusWrapperConsumerBase {
    // v2.5 constructor takes only the wrapper address
    constructor(address wrapperAddress)
        VRFV2PlusWrapperConsumerBase(wrapperAddress) {}
}
```

### 6. Direct Funding Request Method

```solidity
// BEFORE (V2)
requestId = requestRandomness(callbackGasLimit, requestConfirmations, numWords);
// Returns: uint256 requestId

// AFTER (v2.5) — LINK payment
bytes memory extraArgs = VRFV2PlusClient._argsToBytes(
    VRFV2PlusClient.ExtraArgsV1({nativePayment: false})
);
(uint256 requestId, uint256 reqPrice) = requestRandomness(
    callbackGasLimit,
    requestConfirmations,
    numWords,
    extraArgs
);
// Returns: (uint256 requestId, uint256 requestPrice)

// AFTER (v2.5) — native payment
(uint256 requestId, uint256 reqPrice) = requestRandomnessPayInNative(
    callbackGasLimit,
    requestConfirmations,
    numWords,
    extraArgs
);
```

### 7. Import Path Summary

| Component | V2 | v2.5 |
|---|---|---|
| Consumer base (subscription) | `vrf/VRFConsumerBaseV2.sol` | `vrf/dev/VRFConsumerBaseV2Plus.sol` |
| Coordinator interface | `interfaces/VRFCoordinatorV2Interface.sol` | Inherited via `VRFConsumerBaseV2Plus` |
| Client library | Not needed | `vrf/dev/libraries/VRFV2PlusClient.sol` |
| Wrapper base (direct) | `vrf/VRFV2WrapperConsumerBase.sol` | `vrf/dev/VRFV2PlusWrapperConsumerBase.sol` |

## Coordinator Addresses

V2 and v2.5 use **different coordinator addresses**. After migrating the contract code, also update:
- The coordinator address passed to the constructor
- The subscription (v2 subscriptions are not carried over to v2.5)
- Any hardcoded contract addresses in scripts or deployment configs

Get v2.5 addresses from `supported-networks.md`.

## Common Compile Errors After Migration

| Error | Likely cause |
|---|---|
| `VRFConsumerBaseV2Plus: not found` | Wrong import path; use `vrf/dev/` prefix |
| `requestRandomWords: too many arguments` | Still using positional V2 call; switch to struct |
| `Expected identifier but got memory` | Using `memory` in fulfill; change to `calldata` |
| `uint64 to uint256 implicit conversion` | Sub ID still declared as `uint64` |
| `VRFV2PlusWrapperConsumerBase: too many arguments` | Passing LINK address to v2.5 constructor; remove it |
