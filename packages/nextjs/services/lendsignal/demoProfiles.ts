import type { BorrowerStrength } from "./creditBureau";
import type { BusinessProfile } from "./types";

/**
 * Preloaded demo borrowers (Feature 1). Selecting one auto-fills the form and
 * attaches SIX small text documents — one per evidence category (financials, tax,
 * bank, A/R, debt, legal). Each set is written to be unambiguously strong / medium
 * / weak so the attested analysis lands on a clearly marked band. `strength` also
 * keys the mock bureau and a demo-band clamp on the AI score.
 */
export type DemoDocument = {
  filename: string;
  /** Plain-text content; the API route base64-encodes it as a resource. */
  content: string;
};

export type DemoProfile = {
  id: string;
  label: string;
  strength: BorrowerStrength;
  outcome: string;
  profile: BusinessProfile;
  documents: DemoDocument[];
};

const lines = (...l: string[]) => l.join("\n");

export const DEMO_PROFILES: DemoProfile[] = [
  {
    id: "strong",
    label: "Acme Robotics LLC",
    strength: "strong",
    outcome: "Strong — approved (low default risk)",
    profile: {
      legalName: "Acme Robotics LLC",
      dbaName: "Acme Robotics",
      country: "US",
      state: "CA",
      city: "San Jose",
      address: "1200 Innovation Way, San Jose, CA 95110",
      taxIdLast4: "4821",
      industry: "Industrial automation / robotics manufacturing",
      ownerOrPrincipal: { name: "Dana Reyes", role: "CEO", ownershipPct: 60 },
      requestedLoanUsd: 25000,
    },
    documents: [
      {
        filename: "income-statement.txt",
        content: lines(
          "ACME ROBOTICS LLC — INCOME STATEMENT (audited, last full year + YTD)",
          "Revenue: $4,200,000 (prior year $3,650,000, +15% YoY).",
          "Gross profit: $1,890,000 (45% gross margin). EBITDA: $710,000.",
          "Net income: $512,000 (12.2% net margin). YTD 6mo net income $290,000.",
          "Figures tie to the tax return and bank deposits below.",
        ),
      },
      {
        filename: "tax-returns.txt",
        content: lines(
          "ACME ROBOTICS LLC — BUSINESS TAX RETURNS (Form 1065, last 2 years, filed & accepted)",
          "Reported gross receipts: $4.20M (current) and $3.65M (prior) — consistent with the P&L.",
          "No amended returns, no outstanding tax liabilities, EIN matches the business name.",
        ),
      },
      {
        filename: "bank-statements.txt",
        content: lines(
          "ACME ROBOTICS LLC — BANK STATEMENTS (operating account, trailing 12 months)",
          "Average balance: $640,000. Average monthly deposits: $355,000 (lowest month $300,000).",
          "Zero overdrafts or NSF events in 24 months. Deposits reconcile with reported revenue.",
        ),
      },
      {
        filename: "ar-aging.txt",
        content: lines(
          "ACME ROBOTICS LLC — ACCOUNTS RECEIVABLE AGING",
          "Total A/R $410,000: 92% current, 8% 1-30 days, 0% 60+ days.",
          "Top 5 customers are investment-grade enterprises on net-30 terms.",
        ),
      },
      {
        filename: "debt-schedule.txt",
        content: lines(
          "ACME ROBOTICS LLC — DEBT SCHEDULE",
          "One equipment loan, $180,000 remaining, 4.1% APR, never late.",
          "Current ratio 2.4, debt-to-equity 0.35. No revolving balances.",
        ),
      },
      {
        filename: "legal-docs.txt",
        content: lines(
          "ACME ROBOTICS LLC — LEGAL & FORMATION",
          "Articles of Organization filed 2016 (CA). EIN confirmation on file. Licenses current.",
          "No liens, judgments, bankruptcies, or UCC defaults on record.",
        ),
      },
    ],
  },
  {
    id: "medium",
    label: "Northwind Catering Co.",
    strength: "medium",
    outcome: "Medium — manual review (medium default risk)",
    profile: {
      legalName: "Northwind Catering Co.",
      dbaName: "Northwind Events",
      country: "US",
      state: "IL",
      city: "Chicago",
      address: "84 Lakeside Ave, Chicago, IL 60601",
      taxIdLast4: "7733",
      industry: "Food service / event catering",
      ownerOrPrincipal: { name: "Marco Bianchi", role: "Owner", ownershipPct: 100 },
      requestedLoanUsd: 18000,
    },
    documents: [
      {
        filename: "income-statement.txt",
        content: lines(
          "NORTHWIND CATERING CO. — INCOME STATEMENT",
          "Revenue: $1,150,000 (prior year $1,210,000, -5% YoY, seasonal).",
          "Gross margin 35%. Net income: $47,000 (4.1% net margin, thin).",
          "Q4 is ~40% of annual sales — revenue is uneven across the year.",
        ),
      },
      {
        filename: "tax-returns.txt",
        content: lines(
          "NORTHWIND CATERING CO. — TAX RETURNS",
          "Most recent year filed; the prior-year return was NOT provided.",
          "Reported receipts roughly match the P&L for the available year.",
        ),
      },
      {
        filename: "bank-statements.txt",
        content: lines(
          "NORTHWIND CATERING CO. — BANK STATEMENTS",
          "Average balance: $58,000. TWO overdraft events in the last 12 months.",
          "Deposits swing from $40,000 (off-season) to $190,000 (peak).",
        ),
      },
      {
        filename: "ar-aging.txt",
        content: lines(
          "NORTHWIND CATERING CO. — A/R AGING",
          "Total A/R $96,000: 70% current, 18% 31-60 days, 12% 60+ days.",
          "A few corporate clients are slow to pay after large events.",
        ),
      },
      {
        filename: "debt-schedule.txt",
        content: lines(
          "NORTHWIND CATERING CO. — DEBT SCHEDULE",
          "Business line of credit $75,000 (62% utilized) + vehicle loan $22,000.",
          "Payments current; current ratio 1.2. Occasional days-beyond-terms to suppliers.",
        ),
      },
      {
        filename: "legal-docs.txt",
        content: lines(
          "NORTHWIND CATERING CO. — LEGAL",
          "Articles + EIN on file, licenses current.",
          "One open UCC-1 filing tied to the equipment lender. No judgments or bankruptcies.",
        ),
      },
    ],
  },
  {
    id: "weak",
    label: "Sunset Auto Repair",
    strength: "weak",
    outcome: "Weak — denied (high default risk)",
    profile: {
      legalName: "Sunset Auto Repair",
      country: "US",
      state: "AZ",
      city: "Phoenix",
      taxIdLast4: "1090",
      industry: "Automotive repair",
      ownerOrPrincipal: { name: "Jordan Pike", role: "Owner", ownershipPct: 100 },
      requestedLoanUsd: 15000,
    },
    documents: [
      {
        filename: "income-statement.txt",
        content: lines(
          "SUNSET AUTO REPAIR — PARTIAL FINANCIALS (incomplete, unaudited)",
          "Revenue (estimated): $240,000. No formal P&L; figures handwritten and not reconciled.",
          "Likely operating at a small loss after the merchant cash advance remittances.",
        ),
      },
      {
        filename: "tax-returns.txt",
        content: lines(
          "SUNSET AUTO REPAIR — TAX RETURNS",
          "NOT PROVIDED. Last two years of business tax returns are missing.",
          "Unable to verify reported revenue against any filing.",
        ),
      },
      {
        filename: "bank-statements.txt",
        content: lines(
          "SUNSET AUTO REPAIR — BANK STATEMENTS",
          "Balance frequently under $3,000. Multiple NSF / overdraft events most months.",
          "Daily debits to a merchant cash advance provider.",
        ),
      },
      {
        filename: "ar-aging.txt",
        content: lines(
          "SUNSET AUTO REPAIR — A/R AGING",
          "No formal A/R report. Mostly cash/card walk-in revenue; receivables negligible.",
        ),
      },
      {
        filename: "debt-schedule.txt",
        content: lines(
          "SUNSET AUTO REPAIR — DEBT SCHEDULE",
          "Merchant cash advance ~$48,000 outstanding with daily remittance (very high effective APR).",
          "No formal amortization; cash flow is heavily encumbered.",
        ),
      },
      {
        filename: "legal-docs.txt",
        content: lines(
          "SUNSET AUTO REPAIR — LEGAL",
          "Sole proprietorship operating 14 months. An ACTIVE state tax lien is on record.",
          "Business license could not be verified.",
        ),
      },
    ],
  },
];

export const getDemoProfile = (id: string): DemoProfile | undefined => DEMO_PROFILES.find(p => p.id === id);
