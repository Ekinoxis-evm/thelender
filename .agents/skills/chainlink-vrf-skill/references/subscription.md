# VRF v2.5 Subscription Method

## Overview

The subscription method is the recommended approach for most applications. You fund a subscription account with LINK or native coin and add consumer contracts as authorized spenders. Billing is post-fulfillment — the actual gas cost is deducted after the callback completes.

**Official docs:** https://docs.chain.link/vrf/v2-5/subscription/get-a-random-number.md

## Setup Steps

1. Ask the user if they want to create a subscription at vrf.chain.link. 
    1a. If they do, get their **subscription ID**.
    1b. If not, use Managing Subscriptions to write functionality into the contract.
2. Deploy your consumer contract.
3. Fund the subscription with LINK or native coin.
4. Add the contract as an approved consumer for the subscription ID.
5. Call `requestRandomWords` from your contract.

## Complete Consumer Contract

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {VRFConsumerBaseV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

contract VRFSubscriptionConsumer is VRFConsumerBaseV2Plus {
    event RequestSent(uint256 requestId, uint32 numWords);
    event RequestFulfilled(uint256 requestId, uint256[] randomWords);

    struct RequestStatus {
        bool fulfilled;
        bool exists;
        uint256[] randomWords;
    }

    mapping(uint256 => RequestStatus) public s_requests;

    // Subscription ID — uint256 in v2.5 (was uint64 in V2)
    uint256 public s_subscriptionId;

    uint256[] public requestIds;
    uint256 public lastRequestId;

    // Key hash selects the gas lane (max gas price willing to pay for fulfillment)
    // Replace with the appropriate key hash for your network from supported-networks.md
    bytes32 public keyHash;

    // Depends on the number of requested values that you want sent to the
    // fulfillRandomWords() function. Storing each word costs about 20,000 gas,
    // so 60,000 is a safe default for this example contract. Test and adjust
    // this limit based on the network that you select, the size of the request,
    // and the processing of the callback request in the fulfillRandomWords()
    // function.
    uint32 public callbackGasLimit = 60_000;

    // The default is 3, but you can set this higher if more secuirty is necessary.
    uint16 public requestConfirmations = 3;

    // For this example, retrieve 1 random value in one request.
    // Cannot exceed VRFCoordinatorV2_5.MAX_NUM_WORDS.
    uint32 public numWords = 2;

    constructor(
        address coordinatorAddress,
        uint256 subscriptionId,
        bytes32 _keyHash
    ) VRFConsumerBaseV2Plus(coordinatorAddress) {
        s_subscriptionId = subscriptionId;
        keyHash = _keyHash;
    }

    /**
     * @param enableNativePayment true = pay in native coin, false = pay in LINK
     * Pass true only if you funded the subscription with native coin.
     */
    function requestRandomWords(
        bool enableNativePayment
    ) external onlyOwner returns (uint256 requestId) {
        requestId = s_vrfCoordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: keyHash,
                subId: s_subscriptionId,
                requestConfirmations: requestConfirmations,
                callbackGasLimit: callbackGasLimit,
                numWords: numWords,
                extraArgs: VRFV2PlusClient._argsToBytes(
                    VRFV2PlusClient.ExtraArgsV1({nativePayment: enableNativePayment})
                )
            })
        );
        s_requests[requestId] = RequestStatus({
            randomWords: new uint256[](0),
            exists: true,
            fulfilled: false
        });
        requestIds.push(requestId);
        lastRequestId = requestId;
        emit RequestSent(requestId, numWords);
        return requestId;
    }

    // calldata (not memory) — required in @chainlink/contracts v1.1.1+
    function fulfillRandomWords(
        uint256 _requestId,
        uint256[] calldata _randomWords
    ) internal override {
        require(s_requests[_requestId].exists, "request not found");
        s_requests[_requestId].fulfilled = true;
        s_requests[_requestId].randomWords = _randomWords;
        emit RequestFulfilled(_requestId, _randomWords);
    }

    function getRequestStatus(
        uint256 _requestId
    ) external view returns (bool fulfilled, uint256[] memory randomWords) {
        require(s_requests[_requestId].exists, "request not found");
        RequestStatus memory request = s_requests[_requestId];
        return (request.fulfilled, request.randomWords);
    }
}
```

## Package Installation

```bash
# npm
npm install @chainlink/contracts
```

```bash
# Foundry — install from chainlink-evm at a tagged release
forge install smartcontractkit/chainlink-evm@contracts-v1.5.0
```

Add to `foundry.toml`:
```toml
remappings = [
  '@chainlink/contracts/=lib/chainlink-evm/contracts/',
]
```

See [chainlink-evm releases](https://github.com/smartcontractkit/chainlink-evm/releases) for available `contracts-v*` tags.

## Key Parameters

### keyHash (Gas Lane)
Selects the maximum gas price Chainlink nodes will use for fulfillment. Higher key hash = higher max gas price = faster fulfillment on congested networks. See `supported-networks.md` for key hashes per network.

### callbackGasLimit
Maximum gas allocated for your `fulfillRandomWords` callback. Common values:
- Simple storage: 40,000–100,000
- Complex on-chain logic: 200,000–500,000
- Max allowed: 2,500,000

The request reverts if the actual callback uses more gas than this limit. Size up and test carefully.

### requestConfirmations
Block confirmations before fulfillment. Minimum: 3. Higher values improve security against chain reorgs at the cost of latency. Use 3–20 for most applications; increase to 20+ for high-value lotteries.

### numWords
Number of `uint256` random values returned per request. Each word is independently random. Maximum: 500.

## extraArgs — v2.5 Required Field

`extraArgs` is mandatory in v2.5. It selects the payment token for this specific request:

```solidity
extraArgs: VRFV2PlusClient._argsToBytes(
    VRFV2PlusClient.ExtraArgsV1({nativePayment: false}) // LINK payment
)
```

```solidity
extraArgs: VRFV2PlusClient._argsToBytes(
    VRFV2PlusClient.ExtraArgsV1({nativePayment: true}) // Native coin payment
)
```

The subscription must be funded with the corresponding token.

## Managing Subscriptions

Create and manage subscriptions at: https://vrf.chain.link

Or programmatically:

```solidity
IVRFCoordinatorV2Plus coordinator = IVRFCoordinatorV2Plus(coordinatorAddress);

// Create a subscription
uint256 subId = coordinator.createSubscription();

// Fund with LINK (using ERC-677 transferAndCall)
LINK.transferAndCall(address(coordinator), amount, abi.encode(subId));

// Add a consumer
coordinator.addConsumer(subId, consumerAddress);

// Cancel and withdraw
coordinator.cancelSubscription(subId, receivingAddress);
```

## Request Lifecycle

1. Consumer calls `requestRandomWords` → emits `RequestSent`
2. Chainlink VRF node generates randomness off-chain with a cryptographic proof
3. Node submits proof + random values on-chain
4. Coordinator verifies proof, then calls `fulfillRandomWords` on your contract
5. Your contract stores/uses the values, emits `RequestFulfilled`

Fulfillment typically takes a few blocks after the request is included. Latency depends on network conditions and `requestConfirmations`.

## Security Notes

- Do not re-request or cancel randomness after requesting — this can be exploited for bias.
- Do not expose request IDs in a way that lets callers predict which request maps to their action.
- See `security-and-best-practices.md` for full guidance.
- This example code is **unaudited**. Conduct a security audit before production deployment.
