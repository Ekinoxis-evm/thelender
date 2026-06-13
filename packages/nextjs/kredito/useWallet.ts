"use client";

import { useAccount } from "wagmi";
import { useSmartWalletAddress } from "~~/hooks/scaffold-eth/useSmartWallet";

/**
 * The active Kredito credit identity. Prefers the Privy smart wallet (the address
 * that holds the soulbound certificate and is gated by ENS); falls back to the
 * embedded EOA. `undefined` until the user logs in.
 */
export const useKreditoWallet = () => {
  const smartWallet = useSmartWalletAddress();
  const { address: eoa, isConnected } = useAccount();
  const address = smartWallet ?? eoa;

  return {
    address,
    isConnected: Boolean(isConnected || address),
    isSmartWallet: Boolean(smartWallet),
  };
};
