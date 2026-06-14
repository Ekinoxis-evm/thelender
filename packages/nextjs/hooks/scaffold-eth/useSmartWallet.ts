"use client";

import { useCallback, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { Abi, Address, Hex, encodeFunctionData } from "viem";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";

/**
 * Native Privy smart-wallet helpers.
 *
 * WRITES go through this hook: `useSmartWallets().client.sendTransaction(...)`
 * routes the UserOperation through Privy's MANAGED paymaster, i.e. the gas
 * credits configured in the Privy Dashboard ("App pays"). The embedded wallet
 * signs; the smart wallet sends and pays no gas.
 *
 * READS should keep using SE-2's `useScaffoldReadContract`, but pass
 * `{ account: smartWalletAddress }` so the read reflects the smart wallet
 * (e.g. balances / allowances) rather than the embedded EOA signer:
 *
 *   const account = useSmartWalletAddress();
 *   useScaffoldReadContract({ contractName, functionName, account });
 *
 * APIs (confirmed against the live Privy docs / type defs):
 * - `useSmartWallets`, `SmartWalletsProvider` — `@privy-io/react-auth/smart-wallets`
 *   docs.privy.io/wallets/using-wallets/evm-smart-wallets/usage
 * - `client.sendTransaction({ chain, to, data, value })` → single sponsored tx (Hex hash)
 * - `client.sendTransaction({ calls: [{ to, data, value? }, ...] })` → atomic batch
 * - smart wallet address: `usePrivy().user.linkedAccounts` where `type === 'smart_wallet'`
 *   docs.privy.io/wallets/using-wallets/evm-smart-wallets/overview
 */

/**
 * The active smart wallet address from the Privy user's linked accounts, or
 * `undefined` if the smart wallet has not been created yet (e.g. not logged in,
 * or smart wallets not enabled in the dashboard).
 */
export const useSmartWalletAddress = (): Address | undefined => {
  const { user } = usePrivy();
  const smartWallet = user?.linkedAccounts.find(account => account.type === "smart_wallet");
  return smartWallet?.address as Address | undefined;
};

export type SponsoredCall = {
  to: Address;
  data?: Hex;
  value?: bigint;
};

export type WriteContractSponsoredArgs = {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
};

/**
 * Sponsored writes through the native Privy smart wallet.
 *
 * Returns:
 * - `writeContractSponsored(args)` — encodes a contract call and sends it as a
 *   single sponsored tx on the app's target network.
 * - `sendCalls(calls)` — sends an atomic batch of calls (e.g. approve + deposit
 *   for a lending flow) as one sponsored UserOperation.
 * - `isPending`, `error`, `lastTxHash` — UI state for the in-flight write.
 */
export const useSponsoredWrite = () => {
  const { client } = useSmartWallets();
  const { targetNetwork } = useTargetNetwork();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastTxHash, setLastTxHash] = useState<Hex | null>(null);

  const sendCalls = useCallback(
    async (calls: SponsoredCall[]): Promise<Hex> => {
      if (!client) {
        const readinessError = new Error(
          "Smart wallet client is not ready. Make sure the user is logged in and smart wallets are enabled in the Privy Dashboard.",
        );
        setError(readinessError);
        throw readinessError;
      }
      setIsPending(true);
      setError(null);
      try {
        // The batch (`calls`) variant is a UserOperation; the active smart-wallet
        // client already targets `targetNetwork`, so no `chain` field is passed here.
        const hash = await client.sendTransaction({
          calls: calls.map(call => ({ to: call.to, data: call.data, value: call.value })),
        });
        setLastTxHash(hash);
        return hash;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        throw err;
      } finally {
        setIsPending(false);
      }
    },
    [client],
  );

  const writeContractSponsored = useCallback(
    async ({ address, abi, functionName, args, value }: WriteContractSponsoredArgs): Promise<Hex> => {
      if (!client) {
        const readinessError = new Error(
          "Smart wallet client is not ready. Make sure the user is logged in and smart wallets are enabled in the Privy Dashboard.",
        );
        setError(readinessError);
        throw readinessError;
      }
      setIsPending(true);
      setError(null);
      try {
        const data = encodeFunctionData({ abi, functionName, args });
        const hash = await client.sendTransaction({
          chain: targetNetwork,
          to: address,
          data,
          ...(value !== undefined ? { value } : {}),
        });
        setLastTxHash(hash);
        return hash;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        throw err;
      } finally {
        setIsPending(false);
      }
    },
    [client, targetNetwork],
  );

  return { writeContractSponsored, sendCalls, isPending, error, lastTxHash };
};

/**
 * Sign a plain message with the active Privy smart wallet (ERC-191; the smart account produces an
 * ERC-1271 / ERC-6492 signature that `viem.verifyMessage` validates server-side, even before the
 * account is deployed). Used to prove wallet control to backend routes — e.g. the identity mint.
 * Signing is off-chain and free; it is NOT a sponsored transaction.
 */
export const useSmartWalletSign = () => {
  const { client } = useSmartWallets();
  return useCallback(
    async (message: string): Promise<Hex> => {
      if (!client) {
        throw new Error(
          "Smart wallet client is not ready. Make sure the user is logged in and smart wallets are enabled in the Privy Dashboard.",
        );
      }
      return client.signMessage({ message });
    },
    [client],
  );
};
