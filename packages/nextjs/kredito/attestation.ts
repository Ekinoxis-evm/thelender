import { sepolia } from "viem/chains";
import type { RiskTier } from "~~/services/lendsignal/types";

/**
 * Option B — issuer-signed credit attestation (EIP-712).
 *
 * The protocol (issuer) signs a CreditAttestation; a vault verifies the signature
 * onchain (recovers the signer == issuer) to gate lending. ENS provides identity.
 *
 * These constants are CLIENT-SAFE (no secret) and MUST match KreditoVault.sol
 * byte-for-byte.
 *
 * SECURITY (C-1): the domain now binds `verifyingContract` (= the deployed vault
 * address) in addition to `chainId`, so a signature is only valid on THAT vault.
 * The signer therefore MUST know the deployed vault address — use `attestationDomain`
 * / `typedData` with the vault address rather than a constant domain.
 *
 * SECURITY (H-2): the attestation now carries `maxPrincipal` (last field) — the issuer
 * binds the maximum loan size into the signature; the vault enforces `amount <= maxPrincipal`.
 */

/** Build the EIP-712 domain for a specific vault (C-1: verifyingContract = vault address). */
export const attestationDomain = (vault: `0x${string}`) =>
  ({
    name: "Kredito",
    version: "1",
    chainId: sepolia.id,
    verifyingContract: vault,
  }) as const;

export const ATTESTATION_TYPES = {
  CreditAttestation: [
    { name: "borrower", type: "address" },
    { name: "score", type: "uint256" },
    { name: "riskTier", type: "uint8" },
    { name: "evidenceDigest", type: "bytes32" },
    { name: "issuedAt", type: "uint256" },
    { name: "expiresAt", type: "uint256" },
    { name: "maxPrincipal", type: "uint256" },
  ],
} as const;

export const ATTESTATION_PRIMARY_TYPE = "CreditAttestation" as const;

/**
 * H-1: maximum attestation lifetime (expiresAt - issuedAt) the vault accepts.
 * Mirror of `KreditoVault.MAX_ATTESTATION_TTL` (30 days, in seconds).
 */
export const MAX_ATTESTATION_TTL_SECONDS = 30 * 24 * 60 * 60;

/** uint8 riskTier matches CreditTypes.RiskTier: 0 = high, 1 = medium, 2 = low. */
export type CreditAttestation = {
  borrower: `0x${string}`;
  score: number;
  riskTier: number;
  evidenceDigest: `0x${string}`;
  issuedAt: number;
  expiresAt: number;
  /** H-2: issuer-bound upper bound on the loan amount (asset units, e.g. USDC 6-decimals). */
  maxPrincipal: bigint;
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
  maxPrincipal: att.maxPrincipal,
});

/**
 * The full EIP-712 typed-data payload (for sign + recover), bound to `vault`.
 * @param att   the attestation
 * @param vault the deployed KreditoVault address (C-1: domain.verifyingContract)
 */
export const typedData = (att: CreditAttestation, vault: `0x${string}`) =>
  ({
    domain: attestationDomain(vault),
    types: ATTESTATION_TYPES,
    primaryType: ATTESTATION_PRIMARY_TYPE,
    message: toTypedMessage(att),
  }) as const;
