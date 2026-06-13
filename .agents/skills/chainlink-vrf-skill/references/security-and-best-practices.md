# VRF v2.5 Security and Best Practices

## Use `requestId` to Match Randomness Requests with Their Fulfillment

If your contract can have multiple VRF requests in flight simultaneously, the order in which fulfillments arrive cannot be used to drive user-significant behavior. Validators control the order transactions appear on-chain, so requests `A`, `B`, `C` may be fulfilled in any order — `C`, `A`, `B` is just as likely as `A`, `B`, `C`.

Always use `requestId` to match a fulfillment back to its originating request. Never assume FIFO ordering.

## Choose a Safe Block Confirmation Count

Validators can in principle rewrite history to put a randomness request into a different block, producing a different VRF output. This does not let a validator predetermine or predict the value — only re-roll for a fresh one that might or might not be advantageous to them.

Set `requestConfirmations` high enough that the cost of a chain rewrite exceeds the value at risk in your application. There is no universal correct number — it depends on the chain and your application's value-at-risk. Higher = more secure but slower fulfillment.

## Do Not Allow Re-Requesting or Cancellation

Re-requesting or cancelling randomness is an incorrect use of VRF v2.5. Allowing it lets any party discard unfavorable randomness and try again until they get a result they prefer. Do not implement re-request or cancellation paths for specific commitments.

## Don't Accept Inputs After Requesting Randomness

Once you call `requestRandomWords`, do not accept further user inputs that affect the outcome until fulfillment lands. Consider an NFT mint that depends on user actions:

1. Record the user actions that influence the mint.
2. **Stop accepting further user actions that affect the outcome** and issue the randomness request.
3. On fulfillment, mint the NFT.

If you keep accepting inputs after the request, an attacker who rewrites the chain can supply additional inputs that exploit the new outcome — breaking the cryptoeconomic security guarantees.

## `fulfillRandomWords` Must Not Revert

If `fulfillRandomWords` reverts, the VRF service will not retry it. The randomness is lost. Keep callback logic minimal — store the random values and emit an event. Move complex downstream logic (winner selection, token minting, payouts) into separate transactions invoked by you, your users, or a Chainlink Automation node.

```solidity
function fulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) internal override {
    s_requests[requestId].randomWords = randomWords;
    s_requests[requestId].fulfilled = true;
    emit RandomnessFulfilled(requestId);
    // winner selection / NFT minting happens in a separate claimPrize() call
}
```

## Use `VRFConsumerBaseV2Plus` for Subscription Consumers

For the subscription method, inherit from `VRFConsumerBaseV2Plus`. It includes a check that fulfillments come from `VRFCoordinatorV2_5`, which is a critical security boundary.

Do not override `rawFulfillRandomness` — only implement `fulfillRandomWords`. Overriding the wrapper bypasses the coordinator authentication check.

## Avoid ERC-4337 Smart-Account Wallets for Subscription Management

Pre-signed ERC-4337 `UserOperation`s can be executed by any bundler until they expire. If a `UserOperation` executes inside a fulfillment transaction callback, the subscription management call can no-op, delaying or preventing the change. Use an EOA or a standard multisig for subscription management.

## Keep Subscription Balance Well Above the Minimum Balance

Fulfillments require sufficient subscription balance at processing time. If the balance sits near the minimum and multiple consumers make concurrent requests, fulfillments can be delayed. After topping up, previous in-flight requests can take additional time to process.

Set up alerting on subscription balance and refill before it approaches the minimum.

## Never Use Block Data as Randomness (Common Anti-Pattern)

`block.prevrandao`, `block.difficulty`, `blockhash`, and `block.timestamp` are not safe sources of randomness for any value-at-risk application. They are validator-influenceable and must never be used as randomness sources or as a fallback when VRF is unavailable.

For a detailed comparison between Chainlink VRF and RANDAO (`block.prevrandao` on Ethereum), see [Chainlink VRF vs RANDAO on Stack Overflow](https://stackoverflow.com/questions/73938799/chainlink-vrf-or-randao). Short version: RANDAO is biasable by the proposer (who can choose to skip a slot), so it is not suitable as a primitive for high-value randomness consumers.

```solidity
// NEVER DO THIS
uint256 rand = uint256(keccak256(abi.encodePacked(block.timestamp, msg.sender)));
uint256 rand = uint256(blockhash(block.number - 1));
uint256 rand = block.prevrandao;
```

If randomness isn't available, wait or revert — never substitute insecure alternatives.

## Sizing `callbackGasLimit`

The callback gas limit must cover the entire `fulfillRandomWords` execution. If it's too low, the callback reverts and the randomness is lost — it cannot be re-requested with the same value (and re-requesting at all violates the rule above).

Measure your callback's actual gas usage on a testnet, then add a 20–30% buffer. The maximum allowed is 2,500,000. Per-network maximums are listed at https://docs.chain.link/vrf/v2-5/supported-networks.md.

Keep the callback small (store + emit) for two reasons:
1. Lower gas, lower cost.
2. Smaller chance of reverting from any subtle issue.

## Testing with `VRFCoordinatorV2_5Mock`

The `@chainlink/contracts` package ships a mock coordinator for unit-testing subscription consumers without hitting a live network. The mock works for subscription consumers; for direct-funding wrapper consumers, see the chainlink-evm repo for additional mocks.

```solidity
import {VRFCoordinatorV2_5Mock} from "@chainlink/contracts/src/v0.8/vrf/mocks/VRFCoordinatorV2_5Mock.sol";

contract MyConsumerTest is Test {
    VRFCoordinatorV2_5Mock coordinator;
    MyConsumer consumer;
    bytes32 keyHash = bytes32(uint256(1)); // any value works for the mock

    function setUp() public {
        // baseFee, gasPriceLink, weiPerUnitLink
        coordinator = new VRFCoordinatorV2_5Mock(0.1 ether, 1 gwei, 4113797966605025);
        uint256 subId = coordinator.createSubscription();
        coordinator.fundSubscription(subId, 10 ether);
        consumer = new MyConsumer(address(coordinator), subId, keyHash);
        coordinator.addConsumer(subId, address(consumer));
    }

    function test_requestAndFulfill() public {
        uint256 requestId = consumer.requestRandomWords(false);
        // The mock fulfills synchronously
        coordinator.fulfillRandomWords(requestId, address(consumer));
        (, uint256[] memory words) = consumer.getRequestStatus(requestId);
        assertEq(words.length, 2);
    }
}
```

This example code is **unaudited** and provided for educational purposes only. Do not deploy to production without an independent security audit.
