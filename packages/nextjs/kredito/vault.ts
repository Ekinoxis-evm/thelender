import type { CreditAttestation } from "./attestation";
import { sepolia } from "viem/chains";

/**
 * KreditoCreditVault wiring (client-safe). The vault verifies the issuer-signed
 * EIP-712 attestation onchain and disburses an undercollateralized loan.
 *
 * Set NEXT_PUBLIC_KREDITO_VAULT to the deployed address after
 * `yarn deploy --file DeployKreditoVault.s.sol --network sepolia`. The vault is not
 * in SE-2's deployedContracts.ts (deployed out-of-band), so we wire it by ABI + env.
 */
export const KREDITO_VAULT_ADDRESS = (process.env.NEXT_PUBLIC_KREDITO_VAULT ?? "").trim() as `0x${string}` | "";
export const VAULT_CHAIN_ID = sepolia.id;

export type SignedAttestation = {
  attestation: CreditAttestation;
  signature: `0x${string}`;
  issuer: `0x${string}`;
  digest: `0x${string}`;
};

/** The onchain Loan struct (KreditoCreditVault.getLoan). status: 0 None, 1 Active, 2 Repaid. */
export type VaultLoan = {
  borrower: `0x${string}`;
  principal: bigint;
  attestationDigest: `0x${string}`;
  borrowedAt: bigint;
  status: number;
};

// The CreditAttestation tuple, in struct field order (must match KreditoCreditVault).
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
  { type: "function", name: "liquidity", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
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
