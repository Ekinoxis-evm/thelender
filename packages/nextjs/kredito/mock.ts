// Demo data for the Kredito UI before contracts are deployed. Once
// `yarn deploy --file DeployKredito.s.sol` exports ABIs to deployedContracts.ts,
// swap these for `useScaffoldReadContract` results (shapes already match types.ts).
import type { BusinessProfile, CreditCertificate, Loan, VaultState } from "./types";

export const DEMO_PROFILE: BusinessProfile = {
  legalName: "Acme Trading S.A.S.",
  country: "Colombia",
  industry: "Wholesale distribution",
  monthlyRevenueUsd: 145_000,
  requestedLoanUsd: 30_000,
  purpose: "working_capital",
  ensName: "acme.eth",
};

export const DEMO_CERTIFICATE: CreditCertificate = {
  borrower: "0xB0bA1aF1e1d2C3b4A5968778695A4b3C2d1E0F12",
  confidentialAiScore: 840,
  bureauScore: 782,
  combinedScore: 822, // 840*70% + 782*30%
  riskTier: "low",
  attestationHash: "0x9b1c0e7e4f2a3d5c8b6a1f0e9d8c7b6a5f4e3d2c1b0a99887766554433221100",
  bureauReportHash: "0x3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b",
  evidenceDigest: "0x77665544332211009b1c0e7e4f2a3d5c8b6a1f0e9d8c7b6a5f4e3d2c1b0a9988",
  ensName: "acme.eth",
  status: "active",
  issuedAt: Math.floor(Date.now() / 1000) - 2 * 86_400,
  expiresAt: Math.floor(Date.now() / 1000) + 28 * 86_400,
  version: 1,
};

export const DEMO_VAULT: VaultState = {
  liquidityUsd: 90_000,
  reserveUsd: 900,
  totalOutstandingUsd: 10_000,
  originationFeeBps: 300,
  minScore: 750,
};

export const DEMO_LOAN: Loan = {
  id: 1,
  borrower: DEMO_CERTIFICATE.borrower,
  principalUsd: 10_000,
  feeUsd: 300,
  dueAt: Math.floor(Date.now() / 1000) + 30 * 86_400,
  ensName: "acme.eth",
  status: "active",
};

// Preloaded borrower archetypes for the onboarding demo.
export const DEMO_BORROWERS = [
  { key: "strong", label: "Strong borrower", ai: 840, bureau: 782, blurb: "Clean trade history, passes the gate." },
  { key: "medium", label: "Medium borrower", ai: 690, bureau: 668, blurb: "Manual review territory." },
  { key: "weak", label: "Weak borrower", ai: 520, bureau: 540, blurb: "High risk — rejected." },
] as const;
