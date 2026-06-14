/**
 * CreditCertificateRegistry writer — SERVER ONLY.
 *
 * `issueCertificate` / `updateCertificate` are `onlyIssuer` on the contract: the
 * PROTOCOL certifies the business, not the borrower's own wallet. So issuance is
 * signed here, server-side, with the issuer key (the deployer set as issuer in
 * DeployLendSignal). Never import this from a client component.
 *
 * Needs (server env, NOT NEXT_PUBLIC for the key):
 *   NEXT_PUBLIC_CERTIFICATE_REGISTRY  — deployed registry address (Sepolia)
 *   ISSUER_PRIVATE_KEY                — issuer/deployer private key
 *   NEXT_PUBLIC_ALCHEMY_API_KEY       — used to build the Sepolia RPC (fallback: public RPC)
 */
import type { ScoreInputs } from "./types";
import { type Hex, createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const REGISTRY_ADDRESS = (process.env.NEXT_PUBLIC_CERTIFICATE_REGISTRY ?? "") as `0x${string}` | "";
const ISSUER_PK = process.env.ISSUER_PRIVATE_KEY ?? "";
const ALCHEMY_KEY = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY ?? "";

const RPC_URL =
  process.env.SEPOLIA_RPC_URL ||
  (ALCHEMY_KEY ? `https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_KEY}` : "https://rpc.sepolia.org");

export const isRegistryConfigured = () => REGISTRY_ADDRESS.length > 0 && ISSUER_PK.length > 0;

export const registryAddress = () => REGISTRY_ADDRESS;

// Minimal ABI — only what the issuance flow needs. The ScoreInputs tuple order
// MUST match CreditTypes.ScoreInputs in Solidity.
const SCORE_INPUTS_COMPONENTS = [
  { name: "confidentialAiScore", type: "uint256" },
  { name: "bureauScore", type: "uint256" },
  { name: "attestationHash", type: "bytes32" },
  { name: "bureauReportHash", type: "bytes32" },
  { name: "evidenceDigest", type: "bytes32" },
  { name: "expiresAt", type: "uint256" },
] as const;

const REGISTRY_ABI = [
  {
    type: "function",
    name: "issueCertificate",
    stateMutability: "nonpayable",
    inputs: [
      { name: "borrower", type: "address" },
      { name: "inputs", type: "tuple", components: SCORE_INPUTS_COMPONENTS },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "updateCertificate",
    stateMutability: "nonpayable",
    inputs: [
      { name: "borrower", type: "address" },
      { name: "inputs", type: "tuple", components: SCORE_INPUTS_COMPONENTS },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "tokenIdOf",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const toTuple = (si: ScoreInputs) => ({
  confidentialAiScore: BigInt(si.confidentialAiScore),
  bureauScore: BigInt(si.bureauScore),
  attestationHash: si.attestationHash,
  bureauReportHash: si.bureauReportHash,
  evidenceDigest: si.evidenceDigest,
  expiresAt: BigInt(si.expiresAt),
});

export type IssueResult = {
  txHash: Hex;
  action: "issue" | "update";
  registry: `0x${string}`;
  explorer: string;
};

/**
 * Issue (first time) or update (subsequent) the borrower's onchain certificate.
 * Idempotent: picks the right function based on whether a token already exists.
 */
export async function issueCertificateOnchain(borrower: `0x${string}`, scoreInputs: ScoreInputs): Promise<IssueResult> {
  if (!isRegistryConfigured()) {
    throw new Error("Registry not configured. Set NEXT_PUBLIC_CERTIFICATE_REGISTRY and ISSUER_PRIVATE_KEY.");
  }

  const account = privateKeyToAccount((ISSUER_PK.startsWith("0x") ? ISSUER_PK : `0x${ISSUER_PK}`) as Hex);
  const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC_URL) });
  const walletClient = createWalletClient({ account, chain: sepolia, transport: http(RPC_URL) });

  const tokenId = (await publicClient.readContract({
    address: REGISTRY_ADDRESS as `0x${string}`,
    abi: REGISTRY_ABI,
    functionName: "tokenIdOf",
    args: [borrower],
  })) as bigint;

  const action: IssueResult["action"] = tokenId > 0n ? "update" : "issue";

  const txHash = await walletClient.writeContract({
    address: REGISTRY_ADDRESS as `0x${string}`,
    abi: REGISTRY_ABI,
    functionName: action === "update" ? "updateCertificate" : "issueCertificate",
    args: [borrower, toTuple(scoreInputs)],
  });

  // Confirm inclusion so the UI can show a settled tx.
  await publicClient.waitForTransactionReceipt({ hash: txHash });

  return {
    txHash,
    action,
    registry: REGISTRY_ADDRESS as `0x${string}`,
    explorer: `https://sepolia.etherscan.io/tx/${txHash}`,
  };
}
