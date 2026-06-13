// Domain types for the LendSignal credit layer. These mirror the onchain
// CreditCertificateRegistry / LendingVault data so UI components can be wired to
// `useScaffoldReadContract` later with minimal changes.

export type Address = `0x${string}`;
export type Hex = `0x${string}`;

export type RiskTier = "low" | "medium" | "high";

export type CertStatus = "none" | "pending" | "active" | "expired" | "revoked" | "defaulted";

export type CreditCertificate = {
  borrower: Address;
  confidentialAiScore: number; // Chainlink Confidential AI (0..1000)
  bureauScore: number; // CRS bureau (0..1000)
  combinedScore: number; // AI*70% + bureau*30%
  riskTier: RiskTier;
  attestationHash: Hex;
  bureauReportHash: Hex;
  evidenceDigest: Hex;
  ensName?: string;
  status: CertStatus;
  issuedAt: number; // unix seconds
  expiresAt: number; // unix seconds
  version: number;
};

export type BusinessProfile = {
  legalName: string;
  country: string;
  industry: string;
  monthlyRevenueUsd: number;
  requestedLoanUsd: number;
  purpose: "working_capital" | "inventory" | "payroll" | "receivables" | "growth";
  ensName?: string;
};

export type LoanStatus = "none" | "requested" | "active" | "repaid" | "defaulted" | "cancelled";

export type Loan = {
  id: number;
  borrower: Address;
  principalUsd: number;
  feeUsd: number;
  dueAt: number;
  ensName?: string;
  status: LoanStatus;
};

export type VaultState = {
  liquidityUsd: number;
  reserveUsd: number;
  totalOutstandingUsd: number;
  originationFeeBps: number;
  minScore: number;
};
