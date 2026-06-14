import type { CreditAttestation } from "./attestation";
import { sepolia } from "viem/chains";

/**
 * KreditoVault wiring (client-safe). One vault that is BOTH an ERC-4626 share vault
 * (LP capital) with ERC-7540 ASYNCHRONOUS REDEEM, AND an issuer-signed EIP-712
 * attestation-gated lender. Deposits are synchronous; redemptions are request→fulfill→claim
 * because capital is lent out.
 *
 * Set NEXT_PUBLIC_KREDITO_VAULT to the deployed address after
 * `yarn deploy --file DeployKreditoVaultV2.s.sol --network sepolia`. The vault is not in
 * SE-2's deployedContracts.ts (deployed out-of-band), so we wire it by ABI + env.
 *
 * NOTE: the vault SHARE token has 12 decimals (asset 6 + offset 6); shares are minted at
 * assets*1e6. Always price LP positions via `convertToAssets`, never raw share balances.
 */
export const KREDITO_VAULT_ADDRESS = (process.env.NEXT_PUBLIC_KREDITO_VAULT ?? "").trim() as `0x${string}` | "";
export const VAULT_CHAIN_ID = sepolia.id;

export type SignedAttestation = {
  attestation: CreditAttestation;
  signature: `0x${string}`;
  issuer: `0x${string}`;
  digest: `0x${string}`;
};

/** The onchain Loan struct (KreditoVault.getLoan). status: 0 None, 1 Active, 2 Repaid. */
export type VaultLoan = {
  borrower: `0x${string}`;
  principal: bigint;
  attestationDigest: `0x${string}`;
  borrowedAt: bigint;
  status: number;
};

// The CreditAttestation tuple, in struct field order (must match KreditoVault).
const ATTESTATION_TUPLE = {
  name: "att",
  type: "tuple",
  components: [
    { name: "borrower", type: "address" },
    { name: "score", type: "uint256" },
    { name: "riskTier", type: "uint8" },
    { name: "evidenceDigest", type: "bytes32" },
    { name: "issuedAt", type: "uint256" },
    { name: "expiresAt", type: "uint256" },
  ],
} as const;

export const VAULT_ABI = [
  // ---- Lending (attestation-gated) ----
  {
    type: "function",
    name: "borrow",
    stateMutability: "nonpayable",
    inputs: [ATTESTATION_TUPLE, { name: "sig", type: "bytes" }, { name: "amount", type: "uint256" }],
    outputs: [{ name: "loanId", type: "uint256" }],
  },
  {
    type: "function",
    name: "repay",
    stateMutability: "nonpayable",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "isEligible",
    stateMutability: "view",
    inputs: [ATTESTATION_TUPLE, { name: "sig", type: "bytes" }],
    outputs: [{ type: "bool" }],
  },
  { type: "function", name: "minScore", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "asset", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  {
    type: "function",
    name: "openLoanOf",
    stateMutability: "view",
    inputs: [{ name: "borrower", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getLoan",
    stateMutability: "view",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "borrower", type: "address" },
          { name: "principal", type: "uint256" },
          { name: "attestationDigest", type: "bytes32" },
          { name: "borrowedAt", type: "uint256" },
          { name: "status", type: "uint8" },
        ],
      },
    ],
  },
  // ---- Pool accounting ----
  { type: "function", name: "totalAssets", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "idleLiquidity", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalOutstanding", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "convertToAssets",
    stateMutability: "view",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "convertToShares",
    stateMutability: "view",
    inputs: [{ name: "assets", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  // ---- ERC-20 share token ----
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  // ---- ERC-4626 sync deposit ----
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ name: "shares", type: "uint256" }],
  },
  // ---- ERC-7540 async redeem ----
  {
    type: "function",
    name: "requestRedeem",
    stateMutability: "nonpayable",
    inputs: [
      { name: "shares", type: "uint256" },
      { name: "controller", type: "address" },
      { name: "owner", type: "address" },
    ],
    outputs: [{ name: "requestId", type: "uint256" }],
  },
  {
    type: "function",
    name: "cancelRedeemRequest",
    stateMutability: "nonpayable",
    inputs: [
      { name: "shares", type: "uint256" },
      { name: "controller", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "fulfillRedeem",
    stateMutability: "nonpayable",
    inputs: [
      { name: "controller", type: "address" },
      { name: "shares", type: "uint256" },
    ],
    outputs: [{ name: "assets", type: "uint256" }],
  },
  {
    type: "function",
    name: "pendingRedeemRequest",
    stateMutability: "view",
    inputs: [
      { name: "requestId", type: "uint256" },
      { name: "controller", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "claimableRedeemRequest",
    stateMutability: "view",
    inputs: [
      { name: "requestId", type: "uint256" },
      { name: "controller", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "redeem",
    stateMutability: "nonpayable",
    inputs: [
      { name: "shares", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "controller", type: "address" },
    ],
    outputs: [{ name: "assets", type: "uint256" }],
  },
  {
    type: "function",
    name: "maxRedeem",
    stateMutability: "view",
    inputs: [{ name: "controller", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const ERC20_ABI = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

export const sepoliaTxUrl = (hash: string) => `https://sepolia.etherscan.io/tx/${hash}`;
