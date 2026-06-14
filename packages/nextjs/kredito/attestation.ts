import { sepolia } from "viem/chains";
import type { RiskTier } from "~~/services/lendsignal/types";

/**
 * Option B — issuer-signed credit attestation (EIP-712).
 *
 * The protocol (issuer) signs a CreditAttestation; a vault verifies the signature
 * onchain (recovers the signer == issuer) to gate lending. ENS provides identity.
 *
 * These constants are CLIENT-SAFE (no secret) and MUST match KreditoCreditVault.sol
 * byte-for-byte. Domain has NO verifyingContract (chainId-bound only), so the signer
 * doesn't need the deployed vault address.
 */
export const ATTESTATION_DOMAIN = {
  name: "Kredito",
  version: "1",
  chainId: sepolia.id,
} as const;

export const ATTESTATION_TYPES = {
  CreditAttestation: [
    { name: "borrower", type: "address" },
    { name: "score", type: "uint256" },
    { name: "riskTier", type: "uint8" },
    { name: "evidenceDigest", type: "bytes32" },
    { name: "issuedAt", type: "uint256" },
    { name: "expiresAt", type: "uint256" },
  ],
} as const;

export const ATTESTATION_PRIMARY_TYPE = "CreditAttestation" as const;

/** uint8 riskTier matches CreditTypes.RiskTier: 0 = high, 1 = medium, 2 = low. */
export type CreditAttestation = {
  borrower: `0x${string}`;
  score: number;
  riskTier: number;
  evidenceDigest: `0x${string}`;
  issuedAt: number;
  expiresAt: number;
};

export const riskTierToUint = (tier: RiskTier): number =>
  tier === "low_default_risk" ? 2 : tier === "medium_default_risk" ? 1 : 0;

export const riskUintLabel = (n: number): string => (n === 2 ? "Low" : n === 1 ? "Medium" : "High");

/** Convert the JS attestation into the bigint-typed message viem expects for signTypedData. */
export const toTypedMessage = (att: CreditAttestation) => ({
  borrower: att.borrower,
  score: BigInt(att.score),
  riskTier: att.riskTier,
  evidenceDigest: att.evidenceDigest,
  issuedAt: BigInt(att.issuedAt),
  expiresAt: BigInt(att.expiresAt),
});

/** The full EIP-712 typed-data payload (for sign + recover). */
export const typedData = (att: CreditAttestation) =>
  ({
    domain: ATTESTATION_DOMAIN,
    types: ATTESTATION_TYPES,
    primaryType: ATTESTATION_PRIMARY_TYPE,
    message: toTypedMessage(att),
  }) as const;
