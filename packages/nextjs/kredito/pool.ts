import type { BusinessProfile } from "./types";

/**
 * Kreditos p2p funding-pool terms. These are the real protocol parameters; per-pool aggregates
 * (liquidity, outstanding, reserve) come from the pool contract once deployed.
 */
export const POOL = {
  aprBps: 1200, // 12% APY — the default funding rate to request from a pool
  minScore: 600, // minimum eligible credit score
  originationFeeBps: 300, // 3% origination fee
} as const;

/** Blank onboarding profile — no mock prefill; the business fills this in. */
export const EMPTY_PROFILE: BusinessProfile = {
  legalName: "",
  country: "",
  industry: "",
  monthlyRevenueUsd: 0,
  requestedLoanUsd: 0,
  purpose: "working_capital",
  ensName: "",
};
