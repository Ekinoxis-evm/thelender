import { type Hex } from "viem";
import { namehash, normalize } from "viem/ens";

/**
 * Shared KreditoOne ENSv2 helpers (safe for both server and client).
 * The parent is `kredito.eth` on ENSv2 (Sepolia). A subname node is the standard ENS namehash,
 * which equals the controller's on-chain `_node` = keccak256(parentNode, keccak256(label)).
 */
export const KREDITO_PARENT_NAME = "kredito.eth";
export const KREDITO_PARENT_NODE = "0x9481555486db711081424d25f193ca60bb54f9b6e9a7c4032fac5abc95270580" as Hex;

export type CreditStatus = "pending" | "approved" | "denied" | "review" | "defaulted";

export type EnsIdentity = {
  label: string;
  wallet_address: string;
  full_name: string | null;
  node: string | null;
  status: CreditStatus;
  url: string | null;
  twitter: string | null;
  avatar_url: string | null;
  display_name: string | null;
  attestation_hash: string | null;
  tx_hash: string | null;
  created_at: string;
};

export const fullName = (label: string) => `${label}.${KREDITO_PARENT_NAME}`;

/** ENSIP-15 normalize and validate a single label (no dots, non-empty). Throws on invalid input. */
export function normalizeLabel(input: string): string {
  const candidate = normalize(input.trim().toLowerCase());
  if (candidate.length === 0 || candidate.includes(".")) {
    throw new Error("Label must be a single normalized name with no dots");
  }
  return candidate;
}

/** ENSv2 node for `<label>.kredito.eth` — matches KreditoController._node and what clients resolve. */
export function labelToNode(label: string): Hex {
  return namehash(fullName(label));
}

/**
 * The exact message a wallet must sign to authorize minting its own identity. Binds the wallet AND
 * the (normalized) label, so the server can prove the caller controls `wallet` before minting.
 * Build with the NORMALIZED label on both client and server so the strings match.
 */
export const mintMessage = (wallet: string, normalizedLabel: string) =>
  `KreditoOne — claim credit identity\nname: ${normalizedLabel}.${KREDITO_PARENT_NAME}\nwallet: ${wallet}`;

export const isHttpUrl = (u?: string | null): u is string => !!u && /^https?:\/\//i.test(u);
const TWITTER_RE = /^[A-Za-z0-9_]{1,15}$/;
export const isTwitterHandle = (h?: string | null): h is string => !!h && TWITTER_RE.test(h);

/** Drop any profile field that fails its scheme/format allowlist (prevents stored javascript: URLs etc.). */
export function sanitizeProfile(p?: { display_name?: string; url?: string; twitter?: string; avatar_url?: string }): {
  display_name: string | null;
  url: string | null;
  twitter: string | null;
  avatar_url: string | null;
} {
  return {
    display_name: p?.display_name ? p.display_name.trim().slice(0, 80) : null,
    url: isHttpUrl(p?.url) ? (p?.url as string) : null,
    twitter: isTwitterHandle(p?.twitter) ? (p?.twitter as string) : null,
    avatar_url: isHttpUrl(p?.avatar_url) ? (p?.avatar_url as string) : null,
  };
}

/** Minimal ABI for the issuer mint/revoke path (full ABI is auto-generated on deploy). */
export const kreditoControllerAbi = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "label", type: "string" },
      { name: "business", type: "address" },
      { name: "attestationHash", type: "string" },
    ],
    outputs: [
      { name: "tokenId", type: "uint256" },
      { name: "node", type: "bytes32" },
    ],
  },
  {
    type: "function",
    name: "revoke",
    stateMutability: "nonpayable",
    inputs: [{ name: "label", type: "string" }],
    outputs: [],
  },
  {
    type: "function",
    name: "setStatus",
    stateMutability: "nonpayable",
    inputs: [
      { name: "label", type: "string" },
      { name: "status", type: "string" },
    ],
    outputs: [],
  },
] as const;
