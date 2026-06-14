import { withMainnet } from "./enabledChains";
import type { PrivyClientConfig } from "@privy-io/react-auth";
import { Chain } from "viem";
import scaffoldConfig from "~~/scaffold.config";

/**
 * Privy configuration for Scaffold-ETH 2.
 *
 * Grounded in the live Privy docs:
 * - PrivyProvider / config: https://docs.privy.io/wallets/connectors/ethereum/integrations/wagmi
 * - defaultChain / supportedChains: https://docs.privy.io/basics/react/advanced/configuring-evm-networks
 * - embeddedWallets.createOnLogin / showWalletUIs: same wagmi page above
 *
 * Smart wallets + gas sponsorship are NOT configured here in code — they are
 * enabled and configured in the Privy Dashboard (smart-wallet type, paymaster
 * URL, bundler URL, allowed domains, gas credits). See docs/privy.md.
 */

const { targetNetworks } = scaffoldConfig;

// Privy requires a non-empty supportedChains array, and the defaultChain must be
// included in it. We always add mainnet so ENS resolution keeps working even when
// the app's active chain is an L2 (shares `withMainnet` with the wagmi config).
const supportedChains = withMainnet(targetNetworks);

// The primary network the app operates on (first configured target network).
const defaultChain = targetNetworks[0] as Chain;

export const privyConfig: PrivyClientConfig = {
  // "Sponsored wallets" by default: every user gets an embedded wallet on login,
  // which becomes the signer for their (dashboard-configured) smart wallet.
  // In @privy-io/react-auth v3 `createOnLogin` lives under the per-chain key.
  embeddedWallets: {
    ethereum: {
      createOnLogin: "all-users",
    },
    showWalletUIs: true,
  },
  // Email + Google only — no external wallet connectors. Every user gets an embedded wallet on
  // login (→ their sponsored smart wallet), keeping one consistent gasless UX with no wallet setup.
  loginMethods: ["email", "google"],
  defaultChain,
  supportedChains,
  appearance: {
    // Match the Scaffold-ETH app theme. `theme` is overridden at runtime in the
    // provider based on next-themes' resolved theme.
    theme: "light",
    accentColor: "#2299dd",
    showWalletLoginFirst: false,
  },
};
