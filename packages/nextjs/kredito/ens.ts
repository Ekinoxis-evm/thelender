"use client";

import { type CreditAttestation, riskUintLabel, typedData } from "./attestation";
import { KREDITO_VAULT_ADDRESS } from "./vault";
import { createPublicClient, encodeFunctionData, http, recoverTypedDataAddress } from "viem";
import { sepolia } from "viem/chains";
import { namehash, normalize } from "viem/ens";

/**
 * ENS-on-Sepolia integration for Kredito credit identity.
 *
 * A business publishes its issuer-signed CreditAttestation as text records on its
 * ENS name (Sepolia). Anyone can then resolve the name, read the records and verify
 * the issuer's EIP-712 signature — ENS provides identity/discovery, the signature
 * provides trust. This module is CLIENT-SAFE (no secrets); the only env it touches
 * is the public Alchemy key used to build the Sepolia RPC URL.
 *
 * We read the ENS Registry + PublicResolver directly (rather than the Universal
 * Resolver) because the registry/resolver interface is stable across ENS versions
 * and avoids cross-version Universal Resolver quirks on testnets.
 */

// ENS Registry — same address on Sepolia as on mainnet.
export const ENS_REGISTRY_ADDRESS = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e" as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

// Text-record keys carrying the published attestation.
export const KREDITO_ATTESTATION = "kredito.attestation" as const;
export const KREDITO_SCORE = "kredito.score" as const;
export const KREDITO_RISK = "kredito.risk" as const;

/** Minimal ENS Registry ABI — resolver lookup only. */
export const REGISTRY_ABI = [
  {
    type: "function",
    name: "resolver",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

/** PublicResolver ABI — addr/text reads, setText/multicall writes. */
export const RESOLVER_ABI = [
  {
    type: "function",
    name: "addr",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "text",
    stateMutability: "view",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
    ],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "setText",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
      { name: "value", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "multicall",
    stateMutability: "nonpayable",
    inputs: [{ name: "data", type: "bytes[]" }],
    outputs: [{ name: "results", type: "bytes[]" }],
  },
] as const;

const sepoliaRpcUrl = () => {
  const key = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
  return key ? `https://eth-sepolia.g.alchemy.com/v2/${key}` : "https://rpc.sepolia.org";
};

/** Module-level Sepolia client — ENS resolution + record reads run here. */
export const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(sepoliaRpcUrl()),
});

/** The attestation shape exactly as it is serialised into the `kredito.attestation` record. */
export type PublishedAttestation = CreditAttestation & {
  issuer: `0x${string}`;
  signature: `0x${string}`;
};

export type VerifyChecks = {
  signatureValid: boolean;
  boundToName: boolean;
  notExpired: boolean;
};

export type VerifyResult = {
  ok: boolean;
  reason?: string;
  resolvedAddress: `0x${string}` | null;
  record: PublishedAttestation | null;
  recoveredSigner?: `0x${string}`;
  checks: VerifyChecks;
};

const NO_CHECKS: VerifyChecks = { signatureValid: false, boundToName: false, notExpired: false };

/** Resolve a name's resolver address from the registry; null if unset (zero). */
export const getResolver = async (name: string): Promise<`0x${string}` | null> => {
  const node = namehash(normalize(name));
  const resolver = (await publicClient.readContract({
    address: ENS_REGISTRY_ADDRESS,
    abi: REGISTRY_ABI,
    functionName: "resolver",
    args: [node],
  })) as `0x${string}`;
  return resolver.toLowerCase() === ZERO_ADDRESS ? null : resolver;
};

/** Read the resolved address + the parsed `kredito.attestation` record for a name. */
export const readKreditoEns = async (
  name: string,
): Promise<{ resolvedAddress: `0x${string}` | null; record: PublishedAttestation | null }> => {
  const node = namehash(normalize(name));
  const resolver = await getResolver(name);
  if (!resolver) return { resolvedAddress: null, record: null };

  const [addrResult, textResult] = await Promise.allSettled([
    publicClient.readContract({ address: resolver, abi: RESOLVER_ABI, functionName: "addr", args: [node] }),
    publicClient.readContract({
      address: resolver,
      abi: RESOLVER_ABI,
      functionName: "text",
      args: [node, KREDITO_ATTESTATION],
    }),
  ]);

  let resolvedAddress: `0x${string}` | null = null;
  if (addrResult.status === "fulfilled") {
    const addr = addrResult.value as `0x${string}`;
    resolvedAddress = addr && addr.toLowerCase() !== ZERO_ADDRESS ? addr : null;
  }

  let record: PublishedAttestation | null = null;
  if (textResult.status === "fulfilled" && typeof textResult.value === "string" && textResult.value.length > 0) {
    try {
      // H-2: maxPrincipal is serialized as a string; coerce back to bigint to match CreditAttestation.
      const parsed = JSON.parse(textResult.value) as Omit<PublishedAttestation, "maxPrincipal"> & {
        maxPrincipal: string | number | bigint;
      };
      record = { ...parsed, maxPrincipal: BigInt(parsed.maxPrincipal) };
    } catch {
      record = null;
    }
  }

  return { resolvedAddress, record };
};

/** Read + verify a published attestation: signature, name-binding, expiry. */
export const verifyPublished = async (name: string): Promise<VerifyResult> => {
  let resolver: `0x${string}` | null;
  try {
    resolver = await getResolver(name);
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "Failed to resolve the name on Sepolia.",
      resolvedAddress: null,
      record: null,
      checks: NO_CHECKS,
    };
  }
  if (!resolver) {
    return {
      ok: false,
      reason: "This name has no resolver on Sepolia — it may be unregistered or unconfigured.",
      resolvedAddress: null,
      record: null,
      checks: NO_CHECKS,
    };
  }

  const { resolvedAddress, record } = await readKreditoEns(name);
  if (!record) {
    return {
      ok: false,
      reason: "No Kredito attestation record is published on this name.",
      resolvedAddress,
      record: null,
      checks: NO_CHECKS,
    };
  }

  // Reconstruct the canonical CreditAttestation from the record fields.
  const att: CreditAttestation = {
    borrower: record.borrower,
    score: record.score,
    riskTier: record.riskTier,
    evidenceDigest: record.evidenceDigest,
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
    maxPrincipal: record.maxPrincipal,
  };

  let recoveredSigner: `0x${string}` | undefined;
  let signatureValid = false;
  try {
    // C-1: the signature is bound to the vault address (domain.verifyingContract); recover with it.
    const recovered = (await recoverTypedDataAddress({
      ...typedData(att, KREDITO_VAULT_ADDRESS as `0x${string}`),
      signature: record.signature,
    })) as `0x${string}`;
    recoveredSigner = recovered;
    signatureValid = recovered.toLowerCase() === record.issuer.toLowerCase();
  } catch {
    signatureValid = false;
  }

  const boundToName = resolvedAddress?.toLowerCase() === record.borrower.toLowerCase();
  const notExpired = Math.floor(Date.now() / 1000) < record.expiresAt;

  const checks: VerifyChecks = { signatureValid, boundToName, notExpired };
  const ok = signatureValid && boundToName && notExpired;

  return {
    ok,
    reason: ok
      ? undefined
      : !signatureValid
        ? "Issuer signature did not recover to the published issuer."
        : !boundToName
          ? "The attestation's borrower does not match the address this name resolves to."
          : "The attestation has expired.",
    resolvedAddress,
    record,
    recoveredSigner,
    checks,
  };
};

/** Build the encoded setText calls (attestation JSON + score + risk) for a multicall. */
export const buildSetTextCalls = (node: `0x${string}`, att: PublishedAttestation): `0x${string}`[] => {
  const attestationJson = JSON.stringify({
    borrower: att.borrower,
    score: att.score,
    riskTier: att.riskTier,
    evidenceDigest: att.evidenceDigest,
    issuedAt: att.issuedAt,
    expiresAt: att.expiresAt,
    // H-2: bigint maxPrincipal serialized as a base-10 string (JSON has no bigint).
    maxPrincipal: att.maxPrincipal.toString(),
    issuer: att.issuer,
    signature: att.signature,
  });

  return [
    encodeFunctionData({
      abi: RESOLVER_ABI,
      functionName: "setText",
      args: [node, KREDITO_ATTESTATION, attestationJson],
    }),
    encodeFunctionData({
      abi: RESOLVER_ABI,
      functionName: "setText",
      args: [node, KREDITO_SCORE, String(att.score)],
    }),
    encodeFunctionData({
      abi: RESOLVER_ABI,
      functionName: "setText",
      args: [node, KREDITO_RISK, riskUintLabel(att.riskTier)],
    }),
  ];
};

export { namehash, normalize };
