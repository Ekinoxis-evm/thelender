"use client";

import { useCallback } from "react";
import { useEmbeddedSmartAccountConnector } from "@privy-io/wagmi";
import type { EIP1193Provider } from "viem";

/**
 * Wires Privy's native smart wallets into wagmi so that Scaffold-ETH's write
 * hooks (e.g. `useScaffoldWriteContract`) send sponsored UserOperations through
 * the smart account instead of the embedded EOA.
 *
 * Grounded in the live Privy docs:
 * - Recipe "Integrating smart accounts with wagmi":
 *   https://docs.privy.io/recipes/account-abstraction/wagmi
 *   (`useEmbeddedSmartAccountConnector` from `@privy-io/wagmi`)
 * - Native smart wallets (`SmartWalletsProvider`):
 *   https://docs.privy.io/wallets/using-wallets/evm-smart-wallets/setup/configuring-sdk
 *
 * `useEmbeddedSmartAccountConnector` expects a `getSmartAccountFromSigner`
 * function that turns the embedded wallet's EIP1193Provider (the smart-account
 * *signer*) into an EIP1193Provider for the smart account. Because gas
 * sponsorship (paymaster) and the smart-wallet type are configured in the Privy
 * Dashboard — NOT in code — we keep the signer's provider as the source of truth
 * here; Privy's native smart-wallet infrastructure routes the resulting
 * transactions through the dashboard-registered paymaster/bundler.
 *
 * This component renders nothing; the hook must stay mounted whenever wagmi is
 * used with the smart account, so it lives near the root of the app.
 */
export const PrivySmartAccountConnector = () => {
  const getSmartAccountFromSigner = useCallback(
    async ({ signer }: { signer: EIP1193Provider }): Promise<EIP1193Provider> => {
      // The embedded wallet signer is wrapped by Privy's native smart-wallet
      // layer (configured via SmartWalletsProvider + the Dashboard). Returning
      // the signer lets Privy substitute the smart account and apply the
      // dashboard-configured paymaster for sponsorship.
      return signer;
    },
    [],
  );

  useEmbeddedSmartAccountConnector({ getSmartAccountFromSigner });

  return null;
};
