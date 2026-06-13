# VRF v2.5 Direct Funding Method

## Overview

The direct funding method lets a consumer contract pay for each VRF request directly, without maintaining a subscription. The contract must hold enough LINK or native coin before calling `requestRandomWords`. Billing is **upfront** — the cost is estimated and charged at request time.

Use direct funding when:

- You need a one-off randomness request.
- You don't want to manage a subscription account.
- Each request is infrequent enough that subscription overhead is not worth it.

For recurring requests, prefer the subscription method (`subscription.md`).

**Official docs:** https://docs.chain.link/vrf/v2-5/direct-funding/get-a-random-number.md

## Complete Consumer Contract

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {VRFV2PlusWrapperConsumerBase} from "@chainlink/contracts/src/v0.8/vrf/dev/VRFV2PlusWrapperConsumerBase.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";
import {LinkTokenInterface} from "@chainlink/contracts/src/v0.8/shared/interfaces/LinkTokenInterface.sol";
import {ConfirmedOwner} from "@chainlink/contracts/src/v0.8/shared/access/ConfirmedOwner.sol";

contract VRFDirectFundingConsumer is VRFV2PlusWrapperConsumerBase, ConfirmedOwner {
    event RequestSent(uint256 requestId, uint32 numWords);
    event RequestFulfilled(uint256 requestId, uint256[] randomWords, uint256 payment);

    error RequestNotFound(uint256 requestId);
    error WithdrawFailed();

    struct RequestStatus {
        uint256 paid;       // amount paid in juels (LINK) or wei (native)
        bool fulfilled;
        uint256[] randomWords;
        bool native;
    }

    mapping(uint256 => RequestStatus) public s_requests;
    uint256[] public requestIds;
    uint256 public lastRequestId;

    // Depends on the number of requested values that you want sent to the
    // fulfillRandomWords() function. Test and adjust
    // this limit based on the network that you select, the size of the request,
    // and the processing of the callback request in the fulfillRandomWords()
    // function.
    uint32 public callbackGasLimit = 100_000;

    // The default is 3, but you can set this higher.
    uint16 public requestConfirmations = 3;

    // For this example, retrieve 2 random values in one request.
    // Cannot exceed VRFV2Wrapper.getConfig().maxNumWords.
    uint32 public numWords = 2;

    // Pass only the wrapper address — no LINK token address (v2.5 change from V2)
    constructor(address wrapperAddress)
        ConfirmedOwner(msg.sender)
        VRFV2PlusWrapperConsumerBase(wrapperAddress)
    {}

    /**
     * @param enableNativePayment true = pay in native coin, false = pay in LINK.
     * The contract must hold sufficient balance of the chosen token before calling.
     */
    function requestRandomWords(
        bool enableNativePayment
    ) external onlyOwner returns (uint256 requestId) {
        bytes memory extraArgs = VRFV2PlusClient._argsToBytes(
            VRFV2PlusClient.ExtraArgsV1({nativePayment: enableNativePayment})
        );

        uint256 reqPrice;
        if (enableNativePayment) {
            (requestId, reqPrice) = requestRandomnessPayInNative(
                callbackGasLimit,
                requestConfirmations,
                numWords,
                extraArgs
            );
        } else {
            (requestId, reqPrice) = requestRandomness(
                callbackGasLimit,
                requestConfirmations,
                numWords,
                extraArgs
            );
        }

        s_requests[requestId] = RequestStatus({
            paid: reqPrice,
            fulfilled: false,
            randomWords: new uint256[](0),
            native: enableNativePayment
        });
        requestIds.push(requestId);
        lastRequestId = requestId;
        emit RequestSent(requestId, numWords);
        return requestId;
    }

    // VRFV2PlusWrapperConsumerBase uses memory (not calldata) for randomWords
    function fulfillRandomWords(
        uint256 _requestId,
        uint256[] memory _randomWords
    ) internal override {
        if (s_requests[_requestId].paid == 0) revert RequestNotFound(_requestId);
        s_requests[_requestId].fulfilled = true;
        s_requests[_requestId].randomWords = _randomWords;
        emit RequestFulfilled(_requestId, _randomWords, s_requests[_requestId].paid);
    }

    function getRequestStatus(
        uint256 _requestId
    ) external view returns (uint256 paid, bool fulfilled, uint256[] memory randomWords) {
        if (s_requests[_requestId].paid == 0) revert RequestNotFound(_requestId);
        RequestStatus memory request = s_requests[_requestId];
        return (request.paid, request.fulfilled, request.randomWords);
    }

    // i_linkToken is inherited from VRFV2PlusWrapperConsumerBase
    function withdrawLink(address beneficiary, uint256 amount) external onlyOwner {
        bool success = i_linkToken.transfer(beneficiary, amount);
        if (!success) revert WithdrawFailed();
    }

    function withdrawNative(address beneficiary, uint256 amount) external onlyOwner {
        (bool success, ) = beneficiary.call{value: amount}("");
        if (!success) revert WithdrawFailed();
    }

    receive() external payable {}
}
```

## Key Differences from Subscription

| Aspect                     | Subscription                       | Direct Funding                                |
| -------------------------- | ---------------------------------- | --------------------------------------------- |
| Base contract              | `VRFConsumerBaseV2Plus`            | `VRFV2PlusWrapperConsumerBase`                |
| Funding                    | Central subscription account       | Contract holds tokens directly                |
| Billing timing             | Post-fulfillment (actual gas used) | Upfront (estimated at request time)           |
| Request return             | Single `uint256 requestId`         | Tuple `(uint256 requestId, uint256 reqPrice)` |
| Constructor                | Takes coordinator address          | Takes **only** wrapper address                |
| `fulfillRandomWords` param | `uint256[] calldata`               | `uint256[] memory`                            |

## v2.5 Constructor Change (Important)

V2 wrapper constructor required both LINK and wrapper addresses:

```solidity
// V2 — DO NOT USE
VRFV2WrapperConsumerBase(linkAddress, wrapperAddress)
```

V2.5 wrapper constructor takes only the wrapper address:

```solidity
// v2.5 — CORRECT
VRFV2PlusWrapperConsumerBase(wrapperAddress)
```

## Funding the Contract

Simply transfer LINK or native coin to the contract to fund it. Use `billing.md` for calculation on how much to transfer.

## Security Notes

- Ensure the contract holds sufficient balance **before** calling `requestRandomWords`. The call reverts if underfunded.
- The `paid` field in `RequestStatus` records the upfront cost — use it for accounting.
- Get the wrapper address from `supported-networks.md` or https://docs.chain.link/vrf/v2-5/supported-networks.md — never hardcode it without verifying.
- This example code is **unaudited**. Conduct a security audit before production deployment.
